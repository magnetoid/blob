// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const participants = [
  { identity: 'u1', name: 'Ana' },
  { identity: 'u2', name: 'Devin' },
];
vi.mock('@livekit/components-react', () => ({
  useParticipants: () => participants,
  useIsSpeaking: (p: { identity: string }) => p.identity === 'u2',
  useTrackToggle: () => ({ enabled: true, pending: false, toggle: vi.fn() }),
  useLocalParticipant: () => ({ microphoneTrack: undefined }),
  useTrackVolume: () => 0,
}));
vi.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
}));

const { useStore } = await import('../../lib/store.ts');
const { CallBar } = await import('./CallBar.tsx');

afterEach(cleanup);

describe('the call bar', () => {
  it('says where the call is, who is in it and who is talking', () => {
    useStore.setState({
      channels: { 'ch-1': { id: 'ch-1', name: 'design', kind: 'public' } } as never,
      users: {
        u1: { id: 'u1', displayName: 'Ana' },
        u2: { id: 'u2', displayName: 'Devin' },
      } as never,
    });
    render(
      <CallBar
        session={{ callId: 'c1', channelId: 'ch-1', kind: 'huddle', phase: 'connected' }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Huddle in #design' })).toBeTruthy();
    expect(screen.getByText('Huddle · #design')).toBeTruthy();
    expect(screen.getByText('Devin, speaking')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave the call' })).toBeTruthy();
  });

  it('draws no camera or screen control where the workspace allows neither', () => {
    useStore.setState({
      callSettings: {
        huddles: { enabled: true, cameras: false, screenShare: false, maxParticipants: 50 },
        meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
      },
    });
    render(
      <CallBar
        session={{ callId: 'c1', channelId: 'ch-1', kind: 'huddle', phase: 'connected' }}
      />,
    );
    expect(screen.queryByRole('button', { name: /camera/i })).toBeNull();
    // Not /screen/i: the bar always renders "Open the call full screen" (CallControls'
    // `where="bar"` expand button), which the word "screen" alone would false-match.
    expect(screen.queryByRole('button', { name: /shar.*screen/i })).toBeNull();
  });

  it('keeps the people count out of the list — a <ul> may hold only <li> children (R45)', () => {
    useStore.setState({
      channels: { 'ch-1': { id: 'ch-1', name: 'design', kind: 'public' } } as never,
      users: {
        u1: { id: 'u1', displayName: 'Ana' },
        u2: { id: 'u2', displayName: 'Devin' },
      } as never,
    });
    render(
      <CallBar
        session={{ callId: 'c1', channelId: 'ch-1', kind: 'huddle', phase: 'connected' }}
      />,
    );
    const list = document.querySelector('ul.call-people-list');
    expect(list).not.toBeNull();
    expect(Array.from(list!.children).every((child) => child.tagName === 'LI')).toBe(true);

    const count = screen.getByText('2');
    expect(count.className).toContain('call-people-count');
    expect(count.closest('ul')).toBeNull();
    expect(count.closest('.call-people')).not.toBeNull();
  });
});
