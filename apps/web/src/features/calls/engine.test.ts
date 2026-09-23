// @vitest-environment happy-dom
/** The room-ownership races: a connect superseded by a newer one, a leave mid-connect, a
 *  server drop, a late arrival after a replacement. `lib/calls.race.test.ts` covers the
 *  same races one layer up, through `startCall`/`leaveCall`. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micGate, rooms } from './fakeLivekit.ts';

vi.mock('livekit-client', () => import('./fakeLivekit.ts'));

const { connect, disconnect, room, subscribe } = await import('./engine.ts');

function options(over: Partial<Parameters<typeof connect>[2]> = {}): Parameters<typeof connect>[2] {
  return {
    camera: false,
    onPhase: vi.fn(),
    onEnded: vi.fn(),
    onDeviceError: vi.fn(),
    ...over,
  };
}

beforeEach(async () => {
  await disconnect();
  rooms.length = 0;
  micGate.promise = null;
  micGate.open = () => {};
});

describe('the room in use is per attempt, not per call', () => {
  it('a connect superseded by a newer connect never publishes, and its room is disconnected', async () => {
    const onEnded1 = vi.fn();
    const onPhase1 = vi.fn();
    const p1 = connect('wss://a', 'tok-a', options({ onEnded: onEnded1, onPhase: onPhase1 }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    const p2 = connect('wss://b', 'tok-b', options());
    await vi.waitFor(() => expect(rooms.length).toBe(2));
    await vi.waitFor(() => expect(rooms[1]!.state).toBe('connecting'));
    rooms[1]!.finishConnect();
    await Promise.all([p1, p2]);

    expect(room()).toBe(rooms[1]);
    expect(rooms[0]!.disconnectCalls).toBeGreaterThan(0);
    expect(rooms[0]!.state).toBe('disconnected');
    expect(onEnded1).not.toHaveBeenCalled();
    expect(onPhase1).not.toHaveBeenCalledWith('connected');
  });

  it('disconnect() while connecting aborts: nothing published, no onEnded', async () => {
    const onEnded = vi.fn();
    const p = connect('wss://a', 'tok-a', options({ onEnded }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));

    await disconnect();
    await p;

    expect(room()).toBeNull();
    expect(rooms[0]!.state).toBe('disconnected');
    expect(rooms[0]!.micOn).toBe(false);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('Disconnected from a dropped room (left or replaced) does not call its onEnded', async () => {
    const onEnded1 = vi.fn();
    const p1 = connect('wss://a', 'tok-a', options({ onEnded: onEnded1 }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));
    // Replaced, not left — a second connect() before the first ever published.
    const p2 = connect('wss://b', 'tok-b', options());
    await vi.waitFor(() => expect(rooms.length).toBe(2));
    await vi.waitFor(() => expect(rooms[1]!.state).toBe('connecting'));
    rooms[1]!.finishConnect();
    await Promise.all([p1, p2]);

    // The replaced room's own Disconnected already fired (inside connect()'s cleanup);
    // firing it again — a duplicate event, or a slow server echo — still says nothing.
    onEnded1.mockClear();
    rooms[0]!.emit('disconnected');
    expect(onEnded1).not.toHaveBeenCalled();
  });

  it('a server drop of the room in use calls onEnded exactly once and room() becomes null', async () => {
    const onEnded = vi.fn();
    const p = connect('wss://a', 'tok-a', options({ onEnded }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    rooms[0]!.finishConnect();
    await p;
    expect(room()).toBe(rooms[0]);

    rooms[0]!.serverDrop();

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(room()).toBeNull();
  });

  it('a room whose connect resolves after it was already replaced is disconnected and never published (m1)', async () => {
    // The first test above also supersedes a connecting room, but never finishes it —
    // that room's own connect() was already aborted by the replace, so it never really
    // "answers" at all. This is the other ordering: livekit-client's own connect() can
    // resolve, and the drop can land in the microtask gap before the engine's
    // continuation runs — reproduced here by resolving the old room *before* the replace
    // exists to abort it, so nothing has rejected it when it does resolve.
    const onEnded1 = vi.fn();
    const p1 = connect('wss://a', 'tok-a', options({ onEnded: onEnded1 }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));

    rooms[0]!.finishConnect(); // resolves — nothing has touched this room yet
    const p2 = connect('wss://b', 'tok-b', options()); // ...and now something has

    await vi.waitFor(() => expect(rooms.length).toBe(2));
    await vi.waitFor(() => expect(rooms[1]!.state).toBe('connecting'));
    rooms[1]!.finishConnect();
    await Promise.all([p1, p2]);

    expect(room()).toBe(rooms[1]);
    expect(rooms[0]!.state).toBe('disconnected');
    expect(onEnded1).not.toHaveBeenCalled();
  });

  it("an older connect's teardown, finishing after it has itself been superseded again, does not go on to dial its own room (m10)", async () => {
    // A (room0) is superseded by B (room1), which starts tearing A down — and, before
    // that teardown's own await settles, is itself superseded by C (room2). B's `next`
    // (room1) was never dialled at all: it never had anything to abort, so unlike A it
    // is not even *rejected* — it is simply never reached, which is what the guard right
    // after B's own teardown-await is for.
    const p1 = connect('wss://a', 'tok-a', options());
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));

    const p2 = connect('wss://b', 'tok-b', options());
    const p3 = connect('wss://c', 'tok-c', options()); // no await between B and C

    await vi.waitFor(() => expect(rooms.length).toBe(3));
    await vi.waitFor(() => expect(rooms[2]!.state).toBe('connecting'));
    rooms[2]!.finishConnect();
    await Promise.all([p1, p2, p3]);

    expect(room()).toBe(rooms[2]);
    expect(rooms[1]!.state).toBe('disconnected');
  });

  it("onPhase('connected') has already fired while the microphone prompt is still open (m2)", async () => {
    micGate.promise = new Promise<void>((resolve) => (micGate.open = resolve));
    const onPhase = vi.fn();
    const p = connect('wss://a', 'tok-a', options({ onPhase }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    rooms[0]!.finishConnect();

    // Caught with the prompt still held, so "connected" cannot have arrived as a side
    // effect of the mic step settling — it fired on connect, before that step.
    await vi.waitFor(() => expect(onPhase).toHaveBeenCalledWith('connected'));
    expect(rooms[0]!.micOn).toBe(false);

    micGate.open();
    micGate.promise = null;
    await p;
    expect(rooms[0]!.micOn).toBe(true);
    // One phase transition for one join, not two: "connected" is not repeated once the
    // prompt (which is not a phase at all) settles behind it.
    expect(onPhase).toHaveBeenCalledTimes(1);
  });

  it("a dropped room's Reconnecting does not call its onPhase (m16)", async () => {
    const onPhase1 = vi.fn();
    const p1 = connect('wss://a', 'tok-a', options({ onPhase: onPhase1 }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    rooms[0]!.finishConnect();
    await p1;
    expect(room()).toBe(rooms[0]);

    await disconnect(); // dropped on purpose
    onPhase1.mockClear();
    rooms[0]!.emit('reconnecting'); // a late or duplicate event from a room nobody is in
    expect(onPhase1).not.toHaveBeenCalled();
  });

  it('a dropped room whose held microphone prompt then rejects reports no device error (m12)', async () => {
    micGate.promise = new Promise<void>((resolve) => (micGate.open = resolve));
    const onDeviceError1 = vi.fn();
    const p1 = connect('wss://a', 'tok-a', options({ onDeviceError: onDeviceError1 }));
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    rooms[0]!.finishConnect();
    await vi.waitFor(() => expect(room()).toBe(rooms[0])); // published; the prompt is still open

    await disconnect(); // dropped while the prompt is still open
    rooms[0]!.micWillReject = new Error('permission denied');
    micGate.open();
    micGate.promise = null;
    await p1;

    expect(onDeviceError1).not.toHaveBeenCalled();
  });
});

describe('subscribe', () => {
  it('notifies on every publish, including back to null', async () => {
    // `room()`'s declared type is the real `livekit-client` Room — `fakeLivekit.ts`'s
    // stands in for it at runtime only, so the array is typed from `room()` itself
    // rather than imported, which would be a second, incompatible `Room`.
    const seen: Array<ReturnType<typeof room>> = [];
    const unsubscribe = subscribe(() => seen.push(room()));
    const p = connect('wss://a', 'tok-a', options());
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    rooms[0]!.finishConnect();
    await p;
    await disconnect();
    unsubscribe();

    expect(seen).toEqual([rooms[0], null]);
  });
});
