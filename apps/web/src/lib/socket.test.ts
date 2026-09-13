// @vitest-environment happy-dom
/** The control-frame contract: state the server holds per connection is restated on
 * every open.
 *
 * The bug these pin: `send` silently drops frames unless the socket is OPEN, and
 * `presence.sub` was sent from an effect that ran before `connect()` — so presence
 * was dead from the first render, and dead again after every reconnect because the
 * server's subscription set dies with the connection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** The server answering. Any frame counts as proof of life, not just a pong. */
  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket);
vi.stubGlobal('location', { protocol: 'http:', host: 'test.local' });

const { socket } = await import('./socket.ts');

function frames(ws: FakeWebSocket): unknown[] {
  return ws.sent.map((raw) => JSON.parse(raw));
}

describe('control frame replay', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    socket.disconnect();
    vi.useRealTimers();
  });

  it('a control frame sent before the socket opens is delivered on open', () => {
    socket.connect();
    const ws = FakeWebSocket.instances.at(-1)!;

    // Sent while CONNECTING — exactly what the presence effect does on boot.
    socket.sendControl({ t: 'presence.sub', userIds: ['u1', 'u2'] });
    expect(ws.sent).toHaveLength(0);

    ws.open();
    expect(frames(ws)).toContainEqual({ t: 'presence.sub', userIds: ['u1', 'u2'] });
  });

  it('control frames are restated on reconnect; plain sends are not', () => {
    socket.connect();
    const first = FakeWebSocket.instances.at(-1)!;
    first.open();

    socket.sendControl({ t: 'presence.sub', userIds: ['u1'] });
    socket.sendControl({ t: 'channel.focus', channelId: 'c9' });
    socket.send({ t: 'ping' });
    // The socket is a singleton, so an earlier test's control frames may replay on
    // open as well — membership is asserted, not counts.
    expect(frames(first)).toContainEqual({ t: 'ping' });

    // The server restarts; the client reconnects after backoff.
    first.close();
    vi.advanceTimersByTime(5_000);
    const second = FakeWebSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.open();

    const replayed = frames(second);
    expect(replayed).toContainEqual({ t: 'presence.sub', userIds: ['u1'] });
    expect(replayed).toContainEqual({ t: 'channel.focus', channelId: 'c9' });
    expect(replayed).not.toContainEqual({ t: 'ping' });
  });

  it('only the latest frame of each kind is kept', () => {
    socket.connect();
    const first = FakeWebSocket.instances.at(-1)!;
    first.open();

    socket.sendControl({ t: 'channel.focus', channelId: 'c1' });
    socket.sendControl({ t: 'channel.focus', channelId: 'c2' });

    first.close();
    vi.advanceTimersByTime(5_000);
    const second = FakeWebSocket.instances.at(-1)!;
    second.open();

    const focus = frames(second).filter((f) => (f as { t: string }).t === 'channel.focus');
    expect(focus).toEqual([{ t: 'channel.focus', channelId: 'c2' }]);
  });
});


/**
 * Staying connected without a reload.
 *
 * The bug these pin: the heartbeat only ever *wrote*. `send` on a half-open socket
 * succeeds, `readyState` stays OPEN and `onclose` never fires — so a laptop that slept
 * or a proxy that timed the connection out left the tab reading "Connected" with
 * nothing arriving and no reconnect, and the only cure was reloading the page. The
 * server has always dropped a client that goes quiet; this is that rule pointed back.
 */
describe('noticing a connection that has quietly died', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    socket.disconnect();
    vi.useRealTimers();
  });

  it('keeps a socket that answers', () => {
    socket.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();

    // Four heartbeats, each answered. Well past the dead-after window.
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(25_000);
      ws.deliver({ t: 'pong' });
    }

    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('closes a socket that stops answering, so the reconnect and resync can run', () => {
    socket.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    const reconnected = vi.fn();
    socket.onReconnect = reconnected;

    // Silence. The heartbeat keeps writing into a socket that is OPEN and dead.
    vi.advanceTimersByTime(25_000 * 3 + 5_000);
    expect(ws.readyState).toBe(3);

    vi.advanceTimersByTime(5_000);
    const replacement = FakeWebSocket.instances.at(-1)!;
    expect(replacement).not.toBe(ws);
    replacement.open();
    expect(reconnected).toHaveBeenCalled();
    socket.onReconnect = null;
  });

  it('any frame counts as proof of life, not only a pong', () => {
    socket.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();

    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(25_000);
      ws.deliver({ t: 'typing', channelId: 'c1', userId: 'u1', threadRootId: null });
    }

    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
  });

  it('reconnects at once when the network returns instead of serving out the backoff', () => {
    socket.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.close();

    // A later attempt would otherwise wait up to thirty seconds.
    const waiting = FakeWebSocket.instances.length;
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances.length).toBe(waiting + 1);
  });

  it('probes a socket that still claims to be open when the tab comes back', () => {
    socket.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();

    // Long enough that the last frame is stale, short of the heartbeat's own verdict.
    vi.advanceTimersByTime(26_000);
    ws.sent.length = 0;
    window.dispatchEvent(new Event('focus'));
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ t: 'ping' });

    // Nothing answers the probe, so the socket is closed rather than left stuck.
    vi.advanceTimersByTime(4_000);
    expect(ws.readyState).toBe(3);
  });
});
