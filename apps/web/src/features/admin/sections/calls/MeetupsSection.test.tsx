// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const DEFAULTS = {
  huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
  meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
};
const callSettings = vi.fn();
const setCallSettings = vi.fn();
const mediaServer = vi.fn();
vi.mock('../../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/api.ts')>();
  return {
    ...actual,
    api: { ...actual.api, admin: { ...actual.api.admin, callSettings, setCallSettings, mediaServer } },
  };
});

const { useStore } = await import('../../../../lib/store.ts');
const { ApiError } = await import('../../../../lib/api.ts');
const { MeetupsSection } = await import('./MeetupsSection.tsx');

afterEach(cleanup);

describe('Admin → Video meetups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Configured but expected to go unused: proof the page never calls it, not merely
    // that an unconfigured mock would have broken something if it had.
    callSettings.mockResolvedValue(structuredClone(DEFAULTS));
    setCallSettings.mockImplementation(async (s) => s);
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: true, latencyMs: 12,
      error: null, openRooms: 2, lastEventAt: null, webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    // The page reads the store's own copy — the same one `loadCalls` populates and every
    // `calls.settings` broadcast keeps current (R37) — never its own GET.
    useStore.setState({
      callsAvailable: true,
      callsLoaded: true,
      callSettings: structuredClone(DEFAULTS),
    });
  });

  it('switches meetups off, saving both kinds so the huddle half is kept, with no GET', async () => {
    render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
    const toggle = await screen.findByRole('button', { name: 'Allow video meetups' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(setCallSettings).toHaveBeenCalledWith({
        ...DEFAULTS,
        meetups: { ...DEFAULTS.meetups, enabled: false },
      }),
    );
    // R37: the broadcast is the refresh — a save never re-fetches.
    expect(setCallSettings).toHaveBeenCalledTimes(1);
    expect(callSettings).not.toHaveBeenCalled();
  });

  it('updates the controls when a calls.settings frame arrives, with no refetch', async () => {
    render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
    const toggle = await screen.findByRole('button', { name: 'Allow video meetups' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // What the store's own `calls.settings` case does when the frame arrives — a second
    // admin's save, or the same one's save landing back over the socket. Not a fetch.
    act(() => {
      useStore.setState({
        callSettings: { ...DEFAULTS, meetups: { ...DEFAULTS.meetups, enabled: false } },
      });
    });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(callSettings).not.toHaveBeenCalled();
  });

  it('shows the owner what LiveKit says, and nobody else asks', async () => {
    const { unmount } = render(<MeetupsSection onError={vi.fn()} isOwner />);
    expect(await screen.findByText('wss://lk.example.com')).toBeTruthy();
    expect(screen.getByText(/2 calls? open/)).toBeTruthy();
    expect(screen.getByText(/has not reported yet/)).toBeTruthy();
    unmount();

    mediaServer.mockClear();
    render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
    await screen.findByRole('button', { name: 'Allow video meetups' });
    expect(mediaServer).not.toHaveBeenCalled();
    expect(screen.getByText('Calls are available on this server.')).toBeTruthy();
  });

  it('tells the owner how to set LiveKit up when it is not', async () => {
    mediaServer.mockResolvedValue({
      configured: false, url: null, reachable: null, latencyMs: null, error: null,
      openRooms: null, lastEventAt: null, webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    render(<MeetupsSection onError={vi.fn()} isOwner />);
    // The three settings, and the webhook. Not a compose profile: LiveKit starts with
    // the stack now, so a reader who follows `COMPOSE_PROFILES=meetups` would set a
    // variable that does nothing and still have no media server.
    expect(await screen.findByText(/LIVEKIT_URL/)).toBeTruthy();
    expect(screen.queryByText(/COMPOSE_PROFILES/)).toBeNull();
  });

  it('names the firewall where a silent call is diagnosed, not in a comment', async () => {
    // The one failure the server cannot see: signalling answers over TCP through the
    // proxy while media never arrives, so the panel reads healthy and every call is
    // silent. This is the page somebody opens when that happens.
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: true, latencyMs: 7,
      error: null, openRooms: 0, lastEventAt: '2026-09-24T10:00:00Z',
      webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    render(<MeetupsSection onError={vi.fn()} isOwner />);
    expect(await screen.findByText(/UDP/)).toBeTruthy();
  });

  describe('the participant cap (R43)', () => {
    it('starts from the stored value, not blank', async () => {
      render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
      const input = await screen.findByRole('spinbutton', { name: 'Most people in one meetup' });
      expect((input as HTMLInputElement).value).toBe('50');
    });

    it('a refused save leaves the field showing what the server holds, not what was typed', async () => {
      setCallSettings.mockRejectedValueOnce(
        new ApiError(400, 'invalid_input', 'Too many for this server.'),
      );
      render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
      const input = await screen.findByRole('spinbutton', { name: 'Most people in one meetup' });

      fireEvent.change(input, { target: { value: '99' } });
      fireEvent.blur(input);

      await waitFor(() => expect(setCallSettings).toHaveBeenCalledTimes(1));
      // The store's own number never moved — the save was refused — so the field must
      // fall back to showing that, not the 99 that got typed and rejected.
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('50'));
    });

    it('a value outside 2–100 is never sent, and the field reverts on blur', async () => {
      render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
      const input = await screen.findByRole('spinbutton', { name: 'Most people in one meetup' });

      fireEvent.change(input, { target: { value: '500' } });
      fireEvent.blur(input);

      expect(setCallSettings).not.toHaveBeenCalled();
      expect((input as HTMLInputElement).value).toBe('50');
    });

    it('commits a valid change, and keeps showing it once the broadcast confirms it', async () => {
      render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
      const input = await screen.findByRole('spinbutton', { name: 'Most people in one meetup' });

      fireEvent.change(input, { target: { value: '75' } });
      fireEvent.blur(input);

      await waitFor(() =>
        expect(setCallSettings).toHaveBeenCalledWith({
          ...DEFAULTS,
          meetups: { ...DEFAULTS.meetups, maxParticipants: 75 },
        }),
      );

      // What `store.ts`'s `calls.settings` case does once the save's own broadcast lands.
      act(() => {
        useStore.setState({
          callSettings: { ...DEFAULTS, meetups: { ...DEFAULTS.meetups, maxParticipants: 75 } },
        });
      });
      expect((input as HTMLInputElement).value).toBe('75');
    });

    it('another admin’s change arrives over the socket and replaces what is on screen', async () => {
      render(<MeetupsSection onError={vi.fn()} isOwner={false} />);
      const input = await screen.findByRole('spinbutton', { name: 'Most people in one meetup' });
      expect((input as HTMLInputElement).value).toBe('50');

      act(() => {
        useStore.setState({
          callSettings: { ...DEFAULTS, meetups: { ...DEFAULTS.meetups, maxParticipants: 12 } },
        });
      });
      expect((input as HTMLInputElement).value).toBe('12');
    });
  });
});
