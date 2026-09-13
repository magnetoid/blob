/**
 * WebSocket client.
 *
 * Reconnects with backoff and, on every reconnect, asks the server what it missed
 * rather than assuming the gap was empty. The socket carries no writes — sending a
 * message is an HTTP call — so a dropped connection costs live updates, never data.
 */

import type { ClientFrame, ServerEvent } from '@blob/shared';
import { HEARTBEAT_MS, WS_PATH } from '@blob/shared';

type Listener = (event: ServerEvent) => void;
type StatusListener = (status: SocketStatus) => void;

export type SocketStatus = 'connecting' | 'online' | 'offline';

const MAX_BACKOFF_MS = 30_000;

/**
 * How long silence may last before we stop believing the connection.
 *
 * The same arithmetic `realtime/ws.py` uses to drop a client that has gone quiet, kept
 * deliberately in step with it: two heartbeats plus the slack one late frame needs. The
 * server has always had this rule; the client had no equivalent, which is the whole bug
 * below.
 */
const DEAD_AFTER_MS = HEARTBEAT_MS * 2 + 5_000;

/** After a wake-up we ping and give the answer this long before giving up on the socket. */
const PROBE_GRACE_MS = 4_000;

class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closedByUs = false;
  private status: SocketStatus = 'offline';
  /** Fired after a reconnect so the app can fetch the delta it missed. */
  onReconnect: (() => void) | null = null;
  /**
   * The latest control frame of each kind, replayed on every open. A control frame
   * declares desired state — "watch these users' presence", "I'm looking at this
   * channel" — which the server keeps per *connection* and forgets with it. Sending
   * such a frame before the socket opens used to silently drop it (`send` requires
   * OPEN), and a reconnect started with an empty subscription set: presence dots were
   * dead from the first render and froze for good after any network blip.
   */
  private controlFrames = new Map<string, ClientFrame>();
  /**
   * When we last heard *anything* from the server.
   *
   * The heartbeat used to only write. `send` on a half-open socket succeeds silently,
   * `readyState` stays OPEN and `onclose` never fires, so a laptop that slept, a NAT or
   * proxy that timed the connection out, or a phone changing network left the tab
   * showing "Connected" with nothing arriving — and no reconnect, so no resync either.
   * The only cure was reloading the page. A pong proves the link is alive; so does any
   * other frame, which is why this is stamped for all of them.
   */
  private lastAliveAt = 0;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private watching = false;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
    this.watchTheTab();
    this.setStatus('connecting');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}${WS_PATH}`);
    this.ws = ws;

    ws.onopen = () => {
      const reconnected = this.attempt > 0;
      this.attempt = 0;
      this.setStatus('online');
      this.startHeartbeat();
      // Restate desired state first, so the resync that follows finds the server
      // already watching the right things.
      for (const frame of this.controlFrames.values()) this.send(frame);
      if (reconnected) this.onReconnect?.();
    };

    ws.onmessage = (event) => {
      // Before parsing: bytes arrived, so the link is alive whatever they say.
      this.lastAliveAt = Date.now();
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (parsed.t === 'pong') return;
      for (const listener of this.listeners) listener(parsed);
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      this.setStatus('offline');
      if (!this.closedByUs) this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setStatus('offline');
  }

  send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  /** Send now if possible, and again on every future open. For frames that declare
   * state rather than report an event — the server holds them per connection. */
  sendControl(frame: ClientFrame): void {
    this.controlFrames.set(frame.t, frame);
    this.send(frame);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    // Exponential backoff with jitter, so a server restart doesn't produce a
    // synchronised stampede from every open tab in the company.
    const base = Math.min(1000 * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * Come back to a tab, or to a network, without waiting for a timer.
   *
   * Two things make waiting wrong. A background tab has its timers throttled to about
   * once a minute, so both the heartbeat and any scheduled reconnect stall exactly when
   * the server is deciding we are gone; and a socket that died while the machine slept
   * is usually still `OPEN` on the way back, so nothing would ever notice on its own.
   * Registered once, on the first connect, and never removed — the socket is a
   * singleton that lives as long as the page.
   */
  private watchTheTab(): void {
    if (this.watching || typeof window === 'undefined') return;
    this.watching = true;
    const wake = () => this.wake();
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') wake();
      });
    }
  }

  /** Check the connection now: reconnect if it is gone, prove it if it claims to be up. */
  private wake(): void {
    if (this.closedByUs) return;

    if (this.ws?.readyState !== WebSocket.OPEN) {
      // Don't serve out a backoff of up to thirty seconds when the network is back.
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.connect();
      return;
    }

    if (Date.now() - this.lastAliveAt < HEARTBEAT_MS) return;
    this.send({ t: 'ping' });
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      // Nothing came back. Close it ourselves so `onclose` reconnects and the resync
      // that follows fetches whatever arrived while we were not listening.
      if (Date.now() - this.lastAliveAt >= PROBE_GRACE_MS) this.ws?.close();
    }, PROBE_GRACE_MS);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastAliveAt = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastAliveAt > DEAD_AFTER_MS) {
        // Half-open: the writes have been going nowhere. Closing is what turns a tab
        // that is quietly stuck into one that reconnects and catches up.
        this.ws?.close();
        return;
      }
      this.send({ t: 'ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const socket = new Socket();
