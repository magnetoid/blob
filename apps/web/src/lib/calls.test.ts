// @vitest-environment happy-dom
/** Ordinary joins, switches and failures, against a bare mocked engine — `connect` and
 * `disconnect` are plain spies here, so what is under test is `calls.ts`'s own state
 * machine (the `attempt` counter, `starting`), not the engine's room mechanics.
 * `lib/calls.race.test.ts` and `features/calls/engine.test.ts` cover those, against the
 * real engine and a fake `livekit-client`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from './api.ts';

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
const connect = vi.fn();
const disconnect = vi.fn();
vi.mock('../features/calls/engine.ts', () => ({ connect, disconnect }));
const showError = vi.fn();
const push = vi.fn();
vi.mock('./toasts.ts', () => ({ showError, useToasts: { getState: () => ({ push }) } }));

const { useStore } = await import('./store.ts');
const calls = await import('./calls.ts');

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

describe('being in a call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ callSession: null, pendingCallSwitch: null, activeCalls: {} });
    token.mockResolvedValue({ token: 'jwt', url: 'wss://lk' });
    // The real engine calls `onPhase('connected')` itself, before its own device steps
    // — `joinCall` no longer does, so a spy that just resolved would leave every session
    // here stuck at 'connecting'.
    connect.mockImplementation(
      async (
        _url: string,
        _token: string,
        options: { onPhase: (phase: string) => void },
      ) => {
        options.onPhase('connected');
      },
    );
  });

  // First in the file, deliberately: this is the only test that can observe the engine
  // as never having been loaded. `calls.ts`'s own `engine` promise is module state, so
  // every test after this one that joins leaves it resolved for the rest of the file.
  it('leaveCall() with no session and the engine never loaded does not import it', async () => {
    await calls.leaveCall();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('starts, connects and stays in the chat for a huddle', async () => {
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    expect(start).toHaveBeenCalledWith('ch-1', 'huddle');
    expect(connect).toHaveBeenCalledWith('wss://lk', 'jwt', expect.objectContaining({ camera: false }));
    expect(useStore.getState().callSession).toEqual({
      callId: 'call-1', channelId: 'ch-1', kind: 'huddle', phase: 'connected',
    });
    expect(useStore.getState().activeCalls['call-1']).toBeDefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a phase the engine reports before connect() resolves is not overwritten once it does', async () => {
    // The engine can report `reconnecting` — signal dropped, then recovered — while its
    // own device prompt is still open, all before its `connect()` call resolves. A
    // `setPhase('connected')` sitting after that `await`, back when `joinCall` still had
    // one, clobbered exactly this back to 'connected' with the room still reconnecting.
    start.mockResolvedValue(call());
    connect.mockImplementation(
      async (
        _url: string,
        _token: string,
        options: { onPhase: (phase: string) => void },
      ) => {
        options.onPhase('reconnecting');
      },
    );
    await calls.startCall('ch-1', 'huddle');
    expect(useStore.getState().callSession?.phase).toBe('reconnecting');
  });

  it('opens a meetup full screen, with the camera the settings ask for', async () => {
    start.mockResolvedValue(call({ kind: 'meetup' }));
    await calls.startCall('ch-1', 'meetup');
    expect(navigate).toHaveBeenCalledWith('/call/call-1');
    expect(connect).toHaveBeenCalledWith('wss://lk', 'jwt', expect.objectContaining({ camera: true }));
  });

  // Now that a join has happened above, `calls.ts`'s `engine` is resolved for the rest
  // of the file — which is exactly what this one needs.
  it('leaveCall() with no session but a loaded engine still disconnects — an orphaned room must always be leavable', async () => {
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    await calls.leaveCall(); // the ordinary leave, consuming the session
    disconnect.mockClear();

    await calls.leaveCall(); // no session this time, but the engine is loaded
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('already in it: a meetup navigates to its callPath; a huddle does nothing', async () => {
    useStore.setState({
      callSession: { callId: 'call-1', channelId: 'ch-1', kind: 'meetup', phase: 'connected' },
    });
    await calls.startCall('ch-1', 'meetup');
    expect(navigate).toHaveBeenCalledWith('/call/call-1');
    expect(start).not.toHaveBeenCalled();

    navigate.mockClear();
    useStore.setState({
      callSession: { callId: 'call-1', channelId: 'ch-1', kind: 'huddle', phase: 'connected' },
    });
    await calls.startCall('ch-1', 'huddle');
    expect(navigate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('asks before leaving one call for another', async () => {
    useStore.setState({ callSession: { callId: 'x', channelId: 'ch-9', kind: 'huddle', phase: 'connected' } });
    await calls.startCall('ch-1', 'huddle');
    expect(start).not.toHaveBeenCalled();
    expect(useStore.getState().pendingCallSwitch).toEqual({ channelId: 'ch-1', kind: 'huddle' });

    start.mockResolvedValue(call());
    await calls.confirmCallSwitch();
    expect(disconnect).toHaveBeenCalled();
    expect(useStore.getState().callSession?.callId).toBe('call-1');
    expect(useStore.getState().pendingCallSwitch).toBeNull();
  });

  it('cancelCallSwitch() clears the pending switch without touching the current call', async () => {
    useStore.setState({
      callSession: { callId: 'x', channelId: 'ch-9', kind: 'huddle', phase: 'connected' },
      pendingCallSwitch: { channelId: 'ch-1', kind: 'huddle' },
    });
    calls.cancelCallSwitch();
    expect(useStore.getState().pendingCallSwitch).toBeNull();
    expect(useStore.getState().callSession?.callId).toBe('x');
    expect(disconnect).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("startCall's API error shows it and leaves no session", async () => {
    start.mockRejectedValue(new Error('workspace has no media server'));
    await calls.startCall('ch-1', 'huddle');
    expect(showError).toHaveBeenCalled();
    expect(useStore.getState().callSession).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('a failed connect leaves no session and says why', async () => {
    start.mockResolvedValue(call());
    connect.mockRejectedValue(new Error('no route'));
    await calls.startCall('ch-1', 'huddle');
    expect(useStore.getState().callSession).toBeNull();
    expect(showError).toHaveBeenCalled();
  });

  it('a leave during the start POST cancels the join', async () => {
    let resolveStart!: (c: Call) => void;
    start.mockReturnValue(new Promise<Call>((resolve) => (resolveStart = resolve)));
    const p = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(start).toHaveBeenCalled());

    await calls.leaveCall(); // nothing joined yet, but it still ends this attempt
    resolveStart(call());
    await p;

    expect(connect).not.toHaveBeenCalled();
    expect(useStore.getState().callSession).toBeNull();
  });

  it("a stale attempt's onDeviceError and failed-join error show nothing", async () => {
    start.mockResolvedValue(call());
    let rejectConnect!: (error: unknown) => void;
    connect.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectConnect = reject;
      }),
    );
    const p = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    const options = connect.mock.calls[0]![2] as {
      onPhase: (phase: string) => void;
      onDeviceError: (device: 'microphone' | 'camera', error: unknown) => void;
    };

    await calls.leaveCall(); // ends the attempt; its connect() is still out there

    // `onPhase` has no leg here: `leaveCall` already cleared the session, and
    // `setPhase`'s own no-session guard would swallow a stale `onPhase('connected')`
    // regardless of `isCurrent()` — it takes a *second* attempt's session existing for
    // `isCurrent()` to be the thing doing the protecting (see "a stale onPhase does not
    // touch a newer attempt's session" below, m4).
    options.onDeviceError('microphone', new Error('permission denied'));
    rejectConnect(new Error('signal dropped'));
    await p;

    expect(push).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(useStore.getState().callSession).toBeNull();
  });

  it('the room closing ends the session, and leaving full screen replaces the way back to the chat', async () => {
    start.mockResolvedValue(call({ kind: 'meetup' }));
    await calls.startCall('ch-1', 'meetup');
    const { onEnded } = connect.mock.calls[0]![2] as { onEnded: () => void };
    window.history.replaceState(null, '', '/call/call-1');
    onEnded();
    expect(useStore.getState().callSession).toBeNull();
    // `replace`, not a normal push: Back must not return to the call page just left.
    expect(navigate).toHaveBeenLastCalledWith('/c/ch-1', { replace: true });
  });

  it('a start POST that fails after a leave shows nothing', async () => {
    let rejectStart!: (error: unknown) => void;
    start.mockReturnValue(
      new Promise<Call>((_resolve, reject) => {
        rejectStart = reject;
      }),
    );
    const p = calls.startCall('ch-1', 'huddle');
    await vi.waitFor(() => expect(start).toHaveBeenCalled());

    await calls.leaveCall(); // nothing joined yet, but it still ends this attempt
    rejectStart(new Error('workspace has no media server'));
    await p;

    expect(showError).not.toHaveBeenCalled();
    expect(useStore.getState().callSession).toBeNull();
  });

  it("does not let a slow start POST's answer overwrite a frame that already arrived for the same call", async () => {
    // A channel this client is already in gets a call.started frame for someone else's
    // join, then a call.updated once they connect — both ordinary broadcasts — while
    // *this* client's own POST (joining the same call) is still out.
    useStore.getState().applyEvent({ t: 'call.started', call: call({ participantIds: ['other'] }) });
    useStore.getState().applyEvent({
      t: 'call.updated',
      callId: 'call-1',
      participantIds: ['other', 'me'],
    });
    start.mockResolvedValue(call({ participantIds: [] })); // the POST's own, older view
    await calls.startCall('ch-1', 'huddle');

    expect(useStore.getState().activeCalls['call-1']?.participantIds).toEqual(['other', 'me']);
  });

  it("a stale onEnded does not end a newer attempt's session (m3)", async () => {
    start.mockResolvedValueOnce(call()).mockResolvedValueOnce(call({ id: 'call-2', channelId: 'ch-2' }));
    await calls.startCall('ch-1', 'huddle');
    const { onEnded: staleOnEnded } = connect.mock.calls[0]![2] as { onEnded: () => void };

    await calls.leaveCall();
    await calls.startCall('ch-2', 'huddle');
    expect(useStore.getState().callSession?.callId).toBe('call-2');

    staleOnEnded(); // attempt 1's room, reporting in long after it was left
    expect(useStore.getState().callSession?.callId).toBe('call-2');
  });

  it("a stale onPhase does not touch a newer attempt's session (m4)", async () => {
    start.mockResolvedValueOnce(call()).mockResolvedValueOnce(call({ id: 'call-2', channelId: 'ch-2' }));
    await calls.startCall('ch-1', 'huddle');
    const { onPhase: staleOnPhase } = connect.mock.calls[0]![2] as {
      onPhase: (phase: string) => void;
    };

    await calls.leaveCall();
    // Attempt 2's own connect() is held open, so its session is still 'connecting' —
    // not yet touched by its own onPhase — when attempt 1's stale one arrives.
    let resolveConnect2!: () => void;
    connect.mockReturnValue(new Promise<void>((resolve) => (resolveConnect2 = resolve)));
    const p2 = calls.startCall('ch-2', 'huddle');
    await vi.waitFor(() => expect(useStore.getState().callSession?.callId).toBe('call-2'));
    expect(useStore.getState().callSession?.phase).toBe('connecting');

    staleOnPhase('reconnecting');
    expect(useStore.getState().callSession?.phase).toBe('connecting');

    resolveConnect2();
    await p2;
  });
});

describe('isFullScreenFor — a /call/:id route is full screen only for the call you are actually in (R45)', () => {
  const session = { callId: 'a', channelId: 'ch-1', kind: 'huddle' as const, phase: 'connected' as const };

  it('is false off the call view entirely', () => {
    expect(calls.isFullScreenFor({ view: 'home' }, session)).toBe(false);
  });

  it('is false on a call route when you are in no call at all', () => {
    expect(calls.isFullScreenFor({ view: 'call', callId: 'a' }, null)).toBe(false);
  });

  it('is true once the route names the call you are actually in', () => {
    expect(calls.isFullScreenFor({ view: 'call', callId: 'a' }, session)).toBe(true);
  });

  it('is false when the route names someone else’s call — your own dock must not hide', () => {
    // The bug this pins: `Workspace` used to read `route.view === 'call'` alone, so
    // opening `/call/<someone else's id>` while in your own call elsewhere hid your dock
    // (fullScreen) although `CallView` shows only a Join prompt for the other call —
    // connected, audible, and nothing of your own call left on screen.
    expect(calls.isFullScreenFor({ view: 'call', callId: 'b' }, session)).toBe(false);
  });
});
