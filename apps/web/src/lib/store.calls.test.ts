// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from './api.ts';

const state = vi.fn();
const sync = vi.fn();
vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: { ...actual.api, calls: { ...actual.api.calls, state }, sync } };
});

const { useStore } = await import('./store.ts');

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

describe('calls in the store', () => {
  beforeEach(() => {
    useStore.setState({ activeCalls: {}, callsLoaded: false, callsAvailable: false });
    state.mockReset();
  });

  it('starts from what the server says is live', async () => {
    state.mockResolvedValue({
      available: true,
      settings: {
        huddles: { enabled: true, cameras: false, screenShare: true, maxParticipants: 9 },
        meetups: { enabled: false, camerasOnJoin: true, maxParticipants: 50 },
      },
      calls: [call()],
    });
    await useStore.getState().loadCalls();
    const s = useStore.getState();
    expect(s.callsLoaded).toBe(true);
    expect(s.callsAvailable).toBe(true);
    expect(Object.keys(s.activeCalls)).toEqual(['call-1']);
    expect(s.callSettings.huddles.cameras).toBe(false);
    expect(s.callSettings.meetups.enabled).toBe(false);
  });

  it('keeps the live list with the frames', () => {
    const { applyEvent } = useStore.getState();
    applyEvent({ t: 'call.started', call: call() });
    applyEvent({ t: 'call.updated', callId: 'call-1', participantIds: ['u1', 'u2'] });
    expect(useStore.getState().activeCalls['call-1']?.participantIds).toEqual(['u1', 'u2']);
    // An update for a call this client never heard start is not invented into one.
    applyEvent({ t: 'call.updated', callId: 'ghost', participantIds: ['u1'] });
    expect(useStore.getState().activeCalls.ghost).toBeUndefined();
    applyEvent({ t: 'call.ended', callId: 'call-1' });
    expect(useStore.getState().activeCalls).toEqual({});
  });

  it('takes new settings from the frame', () => {
    const settings = {
      huddles: { enabled: false, cameras: true, screenShare: true, maxParticipants: 50 },
      meetups: { enabled: true, camerasOnJoin: false, maxParticipants: 20 },
    };
    useStore.getState().applyEvent({ t: 'calls.settings', settings });
    expect(useStore.getState().callSettings).toEqual(settings);
  });

  it('a failed load leaves the calls it had', async () => {
    // Fake timers: a real failure here also schedules R45's own retry (below), and a
    // real 2s timeout left running past this test would fire mid-suite against whatever
    // the mock is doing by then.
    vi.useFakeTimers();
    try {
      useStore.getState().applyEvent({ t: 'call.started', call: call() });
      state.mockRejectedValue(new Error('offline'));
      await useStore.getState().loadCalls();
      expect(Object.keys(useStore.getState().activeCalls)).toEqual(['call-1']);
    } finally {
      useStore.getState().reset(); // drops the pending retry along with everything else
      vi.useRealTimers();
    }
  });

  describe('a failed loadCalls retries on its own (R45)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('tries twice more — a couple of seconds, then several — and gives up quietly after that', async () => {
      vi.useFakeTimers();
      state.mockRejectedValue(new Error('offline'));

      await useStore.getState().loadCalls();
      expect(state).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(state).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(6_000);
      expect(state).toHaveBeenCalledTimes(3);

      // No fourth attempt, ever — this is "give up quietly", not "keep trying forever"
      // like `resync`'s own retry.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(state).toHaveBeenCalledTimes(3);
    });

    it('a retry that succeeds updates the store like any other load', async () => {
      vi.useFakeTimers();
      state.mockRejectedValueOnce(new Error('offline'));
      state.mockResolvedValueOnce({
        available: true,
        settings: {
          huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
          meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
        },
        calls: [call()],
      });

      await useStore.getState().loadCalls();
      expect(useStore.getState().callsLoaded).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(state).toHaveBeenCalledTimes(2);
      expect(useStore.getState().callsLoaded).toBe(true);
      expect(useStore.getState().activeCalls['call-1']).toBeDefined();
    });

    it('does not outlive a sign-out — reset() cancels a pending retry', async () => {
      vi.useFakeTimers();
      state.mockRejectedValue(new Error('offline'));

      await useStore.getState().loadCalls();
      expect(state).toHaveBeenCalledTimes(1);

      useStore.getState().reset();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(state).toHaveBeenCalledTimes(1); // the retry never fired
    });
  });

  it('a call.ended heard during loadCalls keeps the call gone; a call.started survives; calls.settings wins over the snapshot', async () => {
    let resolveState!: (v: unknown) => void;
    state.mockReturnValue(new Promise((resolve) => (resolveState = resolve)));
    const p = useStore.getState().loadCalls();

    const { applyEvent } = useStore.getState();
    // The snapshot, once it lands, will still call call-1 live — but it ended while
    // the request was out.
    applyEvent({ t: 'call.started', call: call({ id: 'call-1' }) });
    applyEvent({ t: 'call.ended', callId: 'call-1' });
    // The snapshot will not know about call-2 at all — it started after the request
    // was already sent.
    applyEvent({ t: 'call.started', call: call({ id: 'call-2' }) });
    const heardSettings = {
      huddles: { enabled: false, cameras: true, screenShare: true, maxParticipants: 5 },
      meetups: { enabled: true, camerasOnJoin: false, maxParticipants: 5 },
    };
    applyEvent({ t: 'calls.settings', settings: heardSettings });

    resolveState({
      available: true,
      settings: {
        huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
        meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
      },
      calls: [call({ id: 'call-1' })],
    });
    await p;

    const s = useStore.getState();
    expect(s.activeCalls['call-1']).toBeUndefined();
    expect(s.activeCalls['call-2']).toBeDefined();
    expect(s.callSettings).toEqual(heardSettings);
  });

  it('reset() keeps callEngineLoaded — it describes loaded code, not who is signed in', () => {
    useStore.setState({ callEngineLoaded: true });
    useStore.getState().reset();
    expect(useStore.getState().callEngineLoaded).toBe(true);
  });

  it('an older loadCalls answering after a newer one does not resurrect what the newer one already said is gone', async () => {
    let resolveOlder!: (v: unknown) => void;
    let resolveNewer!: (v: unknown) => void;
    state
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOlder = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNewer = resolve)));

    // Started in this order — e.g. a resync racing a mount, or two reconnects in quick
    // succession — but nothing says they have to *answer* in this order.
    const olderLoad = useStore.getState().loadCalls();
    const newerLoad = useStore.getState().loadCalls();
    const settings = {
      huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
      meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
    };

    // The newer request answers first, with the call already gone.
    resolveNewer({ available: true, settings, calls: [] });
    await newerLoad;
    expect(useStore.getState().activeCalls['call-1']).toBeUndefined();

    // The older request answers second, with a snapshot from before the call ended —
    // superseded, so it must apply nothing rather than bring the call back.
    resolveOlder({ available: true, settings, calls: [call()] });
    await olderLoad;
    expect(useStore.getState().activeCalls['call-1']).toBeUndefined();
  });

  it('resync() ends by asking loadCalls to refresh what the socket may have missed', async () => {
    sync.mockResolvedValue({ channels: [], readStates: [], resyncChannelIds: [], messages: [] });
    state.mockResolvedValue({
      available: true,
      settings: {
        huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
        meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
      },
      calls: [],
    });
    expect(state).not.toHaveBeenCalled();
    await useStore.getState().resync();
    await vi.waitFor(() => expect(state).toHaveBeenCalled());
  });
});
