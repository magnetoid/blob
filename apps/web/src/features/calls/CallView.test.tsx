// @vitest-environment happy-dom
/** The full-screen view's connected root carries `data-call-surface` (R30), so
 * `lib/calls.ts`'s `returnFocus` can find it with `closest()` when deciding whether
 * focus leaving a call is still its to give back. Also covers the reconnecting line
 * (round 2's small thing): its own element beside the title, not text appended inside
 * it, so a narrow header ellipsises the title rather than cutting the state off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@livekit/components-react', () => ({
  RoomContext: { Provider: ({ children }: { children: ReactNode }) => <>{children}</> },
  GridLayout: ({ children }: { children: ReactNode }) => <div className="call-grid">{children}</div>,
  ParticipantTile: () => <div data-testid="tile" />,
  useTracks: () => [],
  useTrackToggle: () => ({ enabled: true, pending: false, toggle: vi.fn() }),
  useLocalParticipant: () => ({ microphoneTrack: undefined }),
  useTrackVolume: () => 0,
}));
vi.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
}));
vi.mock('@livekit/components-styles', () => ({}));

let mockRoom: object | null = {};
vi.mock('./useCallRoom.ts', () => ({ useCallRoom: () => mockRoom }));

const leaveCall = vi.fn();
vi.mock('../../lib/calls.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/calls.ts')>();
  return { ...actual, leaveCall };
});

const { useStore } = await import('../../lib/store.ts');
const { CallView } = await import('./CallView.tsx');

function main(): HTMLElement | null {
  return document.querySelector('main.call-view');
}

const session = {
  callId: 'c1',
  channelId: 'ch-1',
  kind: 'huddle' as const,
  phase: 'connected' as const,
};

const call = {
  id: 'c1',
  channelId: 'ch-1',
  kind: 'huddle' as const,
  createdBy: 'u1',
  status: 'active' as const,
  createdAt: '2026-09-22T10:00:00.000Z',
  endedAt: null,
  participantIds: [],
};

afterEach(cleanup);
beforeEach(() => {
  mockRoom = {};
  leaveCall.mockClear();
  useStore.setState({
    callSession: session,
    activeCalls: { c1: call },
    callsLoaded: true,
    channels: { 'ch-1': { id: 'ch-1', name: 'design', kind: 'public' } } as never,
  });
});

describe('the connected view is a call surface (R30)', () => {
  it('carries data-call-surface, so returnFocus can find it', () => {
    render(<CallView callId="c1" />);
    expect(main()).not.toBeNull();
    expect(main()!.getAttribute('data-call-surface')).toBe('true');
  });
});

describe('the reconnecting state, in full screen', () => {
  it('says nothing extra while connected', () => {
    render(<CallView callId="c1" />);
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });

  it('shows the bar’s own wording, beside the title rather than inside it', () => {
    useStore.setState({ callSession: { ...session, phase: 'reconnecting' } });
    render(<CallView callId="c1" />);
    const status = screen.getByText('Reconnecting…');
    expect(status.className).toContain('call-view-status');
    // A sibling of the title, not appended inside it — `.call-view-title` is the one
    // element that ellipsises on overflow, and text inside it would be the first thing
    // a narrow header cuts.
    expect(status.parentElement).toBe(document.querySelector('.call-view-head'));
    expect(screen.getByText(/Huddle · #design/).closest('.call-view-title')).not.toBeNull();
  });
});

describe('the connecting state offers a way out (R45)', () => {
  it('has a Leave that calls leaveCall() while there is a session but no room yet', () => {
    mockRoom = null;
    render(<CallView callId="c1" />);
    expect(screen.getByText('Connecting…')).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Leave' });
    fireEvent.click(button);
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });
});
