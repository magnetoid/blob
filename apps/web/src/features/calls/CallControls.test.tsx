// @vitest-environment happy-dom
/** R42: `.call-ctl[aria-pressed='false']` in `app.css` paints every idle-looking control
 * in the danger colour, and used to catch all three toggles rather than only the two
 * whose off state is the alarming one. Screen share got no "on" treatment either, so
 * sharing your screen right now looked exactly like an idle control. The mic and camera
 * keep the shared `call-ctl-av` class the danger rule keys off; screen share carries
 * `call-ctl-screen` instead, which `app.css` gives the accent "on" treatment
 * `.pane-call-btn[data-live='true']` already uses, and nothing for "off".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mic = { enabled: true, pending: false, toggle: vi.fn() };
const camera = { enabled: true, pending: false, toggle: vi.fn() };
const screenShare = { enabled: false, pending: false, toggle: vi.fn() };
vi.mock('@livekit/components-react', () => ({
  useTrackToggle: ({ source }: { source: string }) =>
    source === 'microphone' ? mic : source === 'camera' ? camera : screenShare,
  useLocalParticipant: () => ({ microphoneTrack: undefined }),
  useTrackVolume: () => 0,
}));
vi.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
}));

const { CallControls } = await import('./CallControls.tsx');

const session = {
  callId: 'c1',
  channelId: 'ch-1',
  kind: 'meetup' as const, // bypasses the huddle settings gate for camera/screen
  phase: 'connected' as const,
};

afterEach(cleanup);
beforeEach(() => {
  mic.enabled = true;
  camera.enabled = true;
  screenShare.enabled = false;
});

describe('screen share reads as on, never as the danger colour (R42)', () => {
  it('gives the mic and camera the off-is-danger class, and withholds it from screen share', () => {
    render(<CallControls session={session} where="bar" />);
    const muteMic = screen.getByRole('button', { name: 'Mute microphone' });
    const camOff = screen.getByRole('button', { name: 'Turn camera off' });
    const share = screen.getByRole('button', { name: 'Share your screen' });
    expect(muteMic.className.split(' ')).toContain('call-ctl-av');
    expect(camOff.className.split(' ')).toContain('call-ctl-av');
    expect(share.className.split(' ')).not.toContain('call-ctl-av');
  });

  it('not sharing carries screen share’s own class but no "on" state — idle, not alarming', () => {
    render(<CallControls session={session} where="bar" />);
    const share = screen.getByRole('button', { name: 'Share your screen' });
    expect(share.getAttribute('aria-pressed')).toBe('false');
    expect(share.className.split(' ')).toContain('call-ctl-screen');
  });

  it('sharing is aria-pressed=true on the same call-ctl-screen class the CSS "on" rule keys off', () => {
    screenShare.enabled = true;
    render(<CallControls session={session} where="bar" />);
    const share = screen.getByRole('button', { name: 'Stop sharing your screen' });
    expect(share.getAttribute('aria-pressed')).toBe('true');
    expect(share.className.split(' ')).toContain('call-ctl-screen');
  });
});
