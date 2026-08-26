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
