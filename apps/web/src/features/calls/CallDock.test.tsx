// @vitest-environment happy-dom
/** R29: the dock holds the last session through the exit. `CallDock` used to gate its
 * own element on the live `session`, which goes null on the very render `usePresence`
 * turns to `state='closed'` — so the `data-state="closed"` node was never created and
 * the bar's exit animation never played; only the full-screen toggle (which does not
 * clear the session) ever animated. Held here the way `DialogPresence` holds its value.
 *
 * R32: holding the session was not enough — `room` goes null synchronously on every exit
 * path too, so the ternary that picks between the real bar and the "Connecting…" strip
 * kept reading the live `room` and flipped to the strip mid-exit: a fresh `.call-bar`
 * element, with its own 160ms entrance, replacing the real one while the dock faded out.
 * `heldRoom` fixes that the same way `heldSession` does.
 *
 * `useCallRoom` is a settable mock: most tests leave it at `null`, so the dock renders
 * its plain "Connecting…" fallback rather than the real `CallBar` and needs none of
 * `@livekit/components-react`'s hooks — what is under test there is the dock element's
 * own presence and `data-state`/`inert`, not what LiveKit renders inside it. The R32
 * tests set a fake room instead, so the real `CallBar` renders, and mock the same
 * `@livekit/components-react` hooks `CallBar.test.tsx` does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const participants = [{ identity: 'u1', name: 'Ana' }];
vi.mock('@livekit/components-react', () => ({
  RoomContext: { Provider: ({ children }: { children: ReactNode }) => <>{children}</> },
  useParticipants: () => participants,
  useIsSpeaking: () => false,
  useTrackToggle: () => ({ enabled: true, pending: false, toggle: vi.fn() }),
  useLocalParticipant: () => ({ microphoneTrack: undefined }),
  useTrackVolume: () => 0,
}));
vi.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
}));

let mockRoom: object | null = null;
vi.mock('./useCallRoom.ts', () => ({ useCallRoom: () => mockRoom }));

const leaveCall = vi.fn();
vi.mock('../../lib/calls.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/calls.ts')>();
  return { ...actual, leaveCall };
});

const { useStore } = await import('../../lib/store.ts');
const { CallDock } = await import('./CallDock.tsx');

function dock(): HTMLElement | null {
  return document.querySelector('.call-dock');
}

function bar(): HTMLElement | null {
  return document.querySelector('.call-bar');
}

const session = {
  callId: 'c1',
  channelId: 'ch-1',
  kind: 'huddle' as const,
  phase: 'connected' as const,
};

afterEach(cleanup);
beforeEach(() => {
  useStore.setState({ callSession: null });
  mockRoom = null;
  leaveCall.mockClear();
});

describe('the dock holds the bar through its exit', () => {
  it('is open, not inert, while there is a session', () => {
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(dock()).not.toBeNull();
    expect(dock()!.getAttribute('data-state')).toBe('open');
    expect(dock()!.hasAttribute('inert')).toBe(false);
  });

  it('carries `data-call-surface`, so `lib/calls.ts` can find it as a place focus may still belong (R30)', () => {
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(dock()!.getAttribute('data-call-surface')).toBe('true');
  });

  it('draws nothing before a call has ever started', () => {
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(dock()).toBeNull();
  });

  it('clearing the session leaves the dock mounted, closed and inert — then gone once the exit ends', () => {
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(dock()).not.toBeNull();

    act(() => {
      useStore.setState({ callSession: null });
    });

    // Still in the document: the bug this pins is the element never existing to animate.
    const closing = dock();
    expect(closing).not.toBeNull();
    expect(closing!.getAttribute('data-state')).toBe('closed');
    expect(closing!.hasAttribute('inert')).toBe(true);

    act(() => {
      closing!.dispatchEvent(new Event('animationend'));
    });
    expect(dock()).toBeNull();
  });

  it('reports presence to the caller as it opens, keeps it through the exit, and drops it once gone', () => {
    const onPresence = vi.fn();
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen={false} onPresence={onPresence} />);
    expect(onPresence).toHaveBeenLastCalledWith(true);

    act(() => {
      useStore.setState({ callSession: null });
    });
    expect(onPresence).toHaveBeenLastCalledWith(true); // the exit is still playing

    act(() => {
      dock()!.dispatchEvent(new Event('animationend'));
    });
    expect(onPresence).toHaveBeenLastCalledWith(false);
  });

  it('full screen never opens the dock, even once the session it would have shown is cleared', () => {
    const onPresence = vi.fn();
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen onPresence={onPresence} />);
    expect(dock()).toBeNull();
    expect(onPresence).toHaveBeenLastCalledWith(false);

    // `usePresence`'s `open` was already false — `fullScreen` alone decides that — so
    // clearing the session here is not a transition it needs to animate, and there is
    // still nothing to chase: no dock, and no further presence call to make.
    act(() => {
      useStore.setState({ callSession: null });
    });
    expect(dock()).toBeNull();
    expect(onPresence).toHaveBeenCalledTimes(1);
  });
});

describe('the dock holds the room through its exit too (R32)', () => {
  it('keeps showing the real bar, on the same element, when the session and the room clear on the same render', () => {
    const room = {};
    mockRoom = room;
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);

    const before = bar();
    expect(before).not.toBeNull();
    expect(before!.getAttribute('aria-label')).toBe('Huddle in Call'); // the real CallBar, not the strip
    expect(before!.querySelector('.call-controls')).not.toBeNull(); // only the real bar has controls

    // Every real exit clears both on the same render: `endSession` nulls the session
    // synchronously, and `engine.ts`'s `drop()` nulls the room before it ever awaits a
    // disconnect. Without `heldRoom` this swaps the section for the "Connecting…" strip.
    act(() => {
      useStore.setState({ callSession: null });
      mockRoom = null;
    });

    const closing = bar();
    expect(closing).not.toBeNull();
    expect(closing).toBe(before); // the same node — no remount, so no fresh entrance
    expect(closing!.getAttribute('aria-label')).toBe('Huddle in Call'); // still the real bar
    expect(closing!.getAttribute('data-phase')).not.toBe('connecting');
  });

  it('does not show a just-ended call’s room while a fast rejoin is still connecting', () => {
    const roomA = {};
    mockRoom = roomA;
    useStore.setState({ callSession: session });
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(bar()!.getAttribute('data-phase')).not.toBe('connecting');

    // A full exit — session and room both clear, and the exit finishes.
    act(() => {
      useStore.setState({ callSession: null });
      mockRoom = null;
    });
    act(() => {
      dock()?.dispatchEvent(new Event('animationend'));
    });
    expect(dock()).toBeNull();

    // A different call starts: a new session lands well before its own room does — the
    // ordinary shape of a join, which awaits a token and a connect().
    act(() => {
      useStore.setState({
        callSession: { callId: 'c2', channelId: 'ch-2', kind: 'huddle', phase: 'connecting' },
      });
    });

    // The strip, not call A's stale room re-used for call B's session.
    expect(bar()!.getAttribute('data-phase')).toBe('connecting');
    expect(bar()!.getAttribute('aria-label')).toBe('Connecting to the call');
  });

  it('does not show the previous room either when the rejoin is the *same* call id (R36)', () => {
    // The commoner rejoin, not the rarer one: `startCall` POSTs start-or-join and the
    // server hands back the live row, so leaving and pressing Join again on the same
    // call returns the *same* call id — the `callId !== callId` guard alone never fires.
    const roomA = {};
    mockRoom = roomA;
    useStore.setState({ callSession: session }); // callId 'c1'
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(bar()!.getAttribute('data-phase')).not.toBe('connecting');

    // A full exit.
    act(() => {
      useStore.setState({ callSession: null });
      mockRoom = null;
    });
    act(() => {
      dock()?.dispatchEvent(new Event('animationend'));
    });
    expect(dock()).toBeNull();

    // The same call, rejoined: a fresh `connecting` session, same id, no room yet — the
    // ordinary shape of any join, which awaits a token and a connect().
    act(() => {
      useStore.setState({
        callSession: { callId: 'c1', channelId: 'ch-1', kind: 'huddle', phase: 'connecting' },
      });
    });

    // The strip, not the previous, now-disconnected room reused for this one.
    expect(bar()!.getAttribute('data-phase')).toBe('connecting');
    expect(bar()!.getAttribute('aria-label')).toBe('Connecting to the call');
  });

  it('a reconnect of the same call (not a rejoin) keeps painting the room already held', () => {
    // The clause this guards against firing for: `reconnecting`, not `connecting`, and
    // the room LiveKit itself is recovering is still the right one to keep showing.
    const roomA = {};
    mockRoom = roomA;
    useStore.setState({ callSession: session }); // callId 'c1', phase 'connected'
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    const before = bar();
    expect(before!.getAttribute('data-phase')).toBe('connected');

    act(() => {
      useStore.setState({ callSession: { ...session, phase: 'reconnecting' } });
    });

    const after = bar();
    expect(after).toBe(before); // the same node — heldRoom was not cleared
    expect(after!.getAttribute('data-phase')).toBe('reconnecting');
  });
});

describe('the "Connecting…" strip has a way out (R45)', () => {
  it('offers Leave while a hung token request holds the room at null, and it calls leaveCall()', () => {
    useStore.setState({ callSession: { ...session, phase: 'connecting' } });
    render(<CallDock fullScreen={false} onPresence={vi.fn()} />);
    expect(bar()!.getAttribute('data-phase')).toBe('connecting');

    const button = screen.getByRole('button', { name: 'Leave the call' });
    fireEvent.click(button);
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });
});
