// @vitest-environment happy-dom
/** The races the Task 8 review found: a leave or a switch landing while a join is still
 * in flight — connecting, or still waiting on a token. Runs the real `lib/calls.ts`
 * against the real `features/calls/engine.ts`, with `livekit-client` swapped for a fake
 * whose `connect()` a test holds open, so a leave can land mid-connect exactly as it
 * would over a slow network. `features/calls/engine.test.ts` covers the same races one
 * layer down, against the engine alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rooms } from '../features/calls/fakeLivekit.ts';
import type { Call } from './api.ts';

vi.mock('livekit-client', () => import('../features/calls/fakeLivekit.ts'));

const start = vi.fn();
const token = vi.fn();
vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: { ...actual.api, calls: { ...actual.api.calls, start, token } } };
});
const navigate = vi.fn();
vi.mock('./router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router.ts')>();
  return { ...actual, navigate };
});
const showError = vi.fn();
const push = vi.fn();
vi.mock('./toasts.ts', () => ({ showError, useToasts: { getState: () => ({ push }) } }));

const { useStore } = await import('./store.ts');
const calls = await import('./calls.ts');
const engine = await import('../features/calls/engine.ts');

const call = (over: Partial<Call> = {}): Call => ({
  id: 'call-1',
  channelId: 'ch-1',
  kind: 'huddle',
  createdBy: 'u1',
  status: 'active',
  createdAt: '2026-09-22T10:00:00.000Z',
  endedAt: null,
  participantIds: [],
  ...over,
});

beforeEach(async () => {
  await engine.disconnect();
  rooms.length = 0;
  vi.clearAllMocks();
  useStore.setState({ callSession: null, pendingCallSwitch: null, activeCalls: {} });
  token.mockResolvedValue({ token: 'jwt', url: 'wss://lk' });
});

describe('leaving or switching while a join is still in flight', () => {
  it('(A) leave while the room is still connecting: no session, room disconnected, mic off, room() null', async () => {
    start.mockResolvedValue(call());
    const p = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));

    await calls.leaveCall();
    // The signal connection answers late — after the leave already tore the room down.
    rooms[0]!.finishConnect();
    await p;

    expect(useStore.getState().callSession).toBeNull();
    expect(rooms[0]!.state).toBe('disconnected');
    expect(rooms[0]!.micOn).toBe(false);
    expect(engine.room()).toBeNull();
  });

  it('(B) leave while the token is still being fetched: no connect at all — no Room built', async () => {
    start.mockResolvedValue(call());
    let giveToken!: (v: { token: string; url: string }) => void;
    token.mockReturnValue(new Promise((r) => (giveToken = r)));

    const p = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(token).toHaveBeenCalled());
    await calls.leaveCall();
    // The token answers after the leave — too late to matter.
    giveToken({ token: 'jwt', url: 'wss://lk' });
    await p;

    expect(rooms.length).toBe(0);
    expect(useStore.getState().callSession).toBeNull();
    expect(engine.room()).toBeNull();
  });

  it('(C) a double click on the call button: one POST, one token, one room', async () => {
    start.mockResolvedValue(call());
    const p1 = calls.startCall('ch-1', 'huddle');
    const p2 = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));
    rooms[0]!.finishConnect();
    await Promise.all([p1, p2]);

    expect(start).toHaveBeenCalledTimes(1);
    expect(token).toHaveBeenCalledTimes(1);
    expect(rooms.length).toBe(1);
    expect(engine.room()).toBe(rooms[0]);
    expect(useStore.getState().callSession?.callId).toBe('call-1');
  });

  it('(E) confirming a switch while the first call is still connecting: the old room is already aborted by the leave, so only the new one can still answer', async () => {
    // Case 10's other ordering — the old room's connect() resolving *before* the switch
    // has disconnected it — is not reachable through this entry point. `confirmCallSwitch`
    // is `await leaveCall(); await startCall(...)`, strictly sequential: nothing can claim
    // `pending` for the new call until `leaveCall` has fully returned, and `leaveCall`
    // does not return until its own `disconnect()` has already reached the old room. By
    // the time a second room could exist to race against, the first one is not merely
    // superseded — it has already been rejected, the way round 1's tests pin (a genuine
    // `disconnect()` call always wins that race). A `finishConnect()` on it after that is
    // necessarily a no-op, which is what this test shows rather than assumes.
    // `engine.test.ts`'s own "m1" is the ordering this one cannot reach, one layer down,
    // where two `connect()` calls really do race with nothing sequencing them.
    start
      .mockResolvedValueOnce(call())
      .mockResolvedValueOnce(call({ id: 'call-2', channelId: 'ch-2' }));
    const p1 = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(rooms.length).toBe(1));
    await vi.waitFor(() => expect(rooms[0]!.state).toBe('connecting'));

    await calls.startCall('ch-2', 'huddle'); // asks, since a call is already connecting
    expect(useStore.getState().pendingCallSwitch).toEqual({ channelId: 'ch-2', kind: 'huddle' });
    const p2 = calls.confirmCallSwitch();
    await vi.waitFor(() => expect(rooms.length).toBe(2));
    await vi.waitFor(() => expect(rooms[1]!.state).toBe('connecting'));

    rooms[1]!.finishConnect();
    rooms[0]!.finishConnect(); // a no-op: room0's connect was rejected well before this
    await Promise.all([p1, p2]);

    expect(useStore.getState().callSession?.callId).toBe('call-2');
    expect(engine.room()).toBe(rooms[1]);
    expect(rooms[0]!.state).toBe('disconnected');
    expect(rooms[0]!.micOn).toBe(false);
    expect(rooms[1]!.micOn).toBe(true);
  });
});
