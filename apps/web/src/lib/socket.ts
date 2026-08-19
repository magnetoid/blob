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

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
    this.setStatus('connecting');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}${WS_PATH}`);
    this.ws = ws;

    ws.onopen = () => {
      const reconnected = this.attempt > 0;
      this.attempt = 0;
      this.setStatus('online');
      this.startHeartbeat();
      if (reconnected) this.onReconnect?.();
    };

    ws.onmessage = (event) => {
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

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ t: 'ping' }), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const socket = new Socket();
