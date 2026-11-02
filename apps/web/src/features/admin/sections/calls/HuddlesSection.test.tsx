// @vitest-environment happy-dom
/** Admin → Huddles (M3 · B2): the light call's settings, saved without touching meetups'. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const DEFAULTS = {
  huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
  meetups: { enabled: false, camerasOnJoin: true, maxParticipants: 12 },
};
const setCallSettings = vi.fn();
const mediaServer = vi.fn();
vi.mock('../../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: { ...actual.api.admin, callSettings: vi.fn(), setCallSettings, mediaServer },
    },
  };
});

const { useStore } = await import('../../../../lib/store.ts');
const { HuddlesSection } = await import('./HuddlesSection.tsx');

afterEach(cleanup);

describe('Admin → Huddles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCallSettings.mockImplementation(async (s) => s);
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: true, latencyMs: 12,
      error: null, openRooms: 0, lastEventAt: null, webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    useStore.setState({ callsAvailable: true, callsLoaded: true, callSettings: structuredClone(DEFAULTS) });
  });

  it('says what each switch does and holds the cap beside its own words', async () => {
    render(<HuddlesSection onError={vi.fn()} isOwner={false} />);
    expect(
      await screen.findByRole('switch', {
        name: 'Allow huddles',
        checked: true,
        description: /The Huddle button in every channel and DM/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', {
        name: 'Screen sharing in huddles',
        description: 'A shared screen carries its sound too.',
      }),
    ).toBeTruthy();
    const cap = screen.getByRole('spinbutton', {
      name: 'Most people in one huddle',
      description: /Between 2 and 100/,
    }) as HTMLInputElement;
    expect(cap.value).toBe('50');
  });

  it('turns cameras off and keeps the meetup half exactly as it was', async () => {
    render(<HuddlesSection onError={vi.fn()} isOwner={false} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Cameras in huddles' }));
    await waitFor(() =>
      expect(setCallSettings).toHaveBeenCalledWith({
        huddles: { ...DEFAULTS.huddles, cameras: false },
        // Not reset to its defaults: the server replaces the whole object.
        meetups: DEFAULTS.meetups,
      }),
    );
  });

  it('greys out the details while huddles are off', async () => {
    useStore.setState({
      callSettings: { ...structuredClone(DEFAULTS), huddles: { ...DEFAULTS.huddles, enabled: false } },
    });
    render(<HuddlesSection onError={vi.fn()} isOwner={false} />);
    const cameras = await screen.findByRole('switch', { name: 'Cameras in huddles' });
    // Base UI draws a switch as a span, so "off the table" is its own attribute.
    expect(cameras.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Screen sharing in huddles' }).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('spinbutton', { name: 'Most people in one huddle' }) as HTMLInputElement).disabled).toBe(true);
    // The switch that turns it all on is not one of the things it greys out.
    expect(screen.getByRole('switch', { name: 'Allow huddles', checked: false }).getAttribute('aria-disabled')).not.toBe('true');
  });
});
