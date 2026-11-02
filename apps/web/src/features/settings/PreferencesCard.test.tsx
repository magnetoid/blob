// @vitest-environment happy-dom
/** Settings → Preferences: how Blob looks, the zone it reads the clock in, and language
 * and input. The palette gallery has its own file. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_PREFS, type UserPrefs } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { PreferencesCard } from './PreferencesCard.tsx';

/** A save that went through: the choice lands in the user, which every control draws from. */
const setPrefs = vi.fn(async (patch: Partial<UserPrefs>) => {
  useStore.setState((s) => ({
    currentUser: s.currentUser && {
      ...s.currentUser,
      prefs: { ...s.currentUser.prefs, ...patch },
    },
  }));
});

function seed(overrides: Partial<UserPrefs> = {}, translationEnabled = false) {
  useStore.setState({
    currentUser: {
      id: 'me',
      displayName: 'Ana',
      timezone: 'Europe/Belgrade',
      prefs: { ...DEFAULT_PREFS, ...overrides },
    } as never,
    setPrefs,
    translationEnabled,
    themes: [],
  } as never);
}

beforeEach(() => seed());

afterEach(() => {
  cleanup();
  setPrefs.mockClear();
  vi.restoreAllMocks();
});

describe('theme and density', () => {
  it('is a choice of one: the current one is pressed, and pressing another moves it', () => {
    render(<PreferencesCard />);
    const theme = screen.getByRole('group', { name: 'Theme' });
    expect(within(theme).getByRole('button', { name: 'System', pressed: true })).toBeTruthy();

    fireEvent.click(within(theme).getByRole('button', { name: 'Dark' }));
    expect(setPrefs).toHaveBeenCalledWith({ theme: 'dark' });
    expect(within(theme).getByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();
    expect(within(theme).getByRole('button', { name: 'System', pressed: false })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('group', { name: 'Density' })).getByRole('button', { name: 'Compact' }));
    expect(setPrefs).toHaveBeenLastCalledWith({ density: 'compact' });
  });

  it('cannot be left with nothing chosen', () => {
    render(<PreferencesCard />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'System' }),
    );
    expect(setPrefs).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', {
        name: 'System',
        pressed: true,
      }),
    ).toBeTruthy();
  });
});

describe('time zone', () => {
  it('shows the zone the account keeps and saves another', async () => {
    const update = vi
      .spyOn(api.me, 'update')
      .mockResolvedValue({ user: { id: 'me', timezone: 'Europe/London', prefs: DEFAULT_PREFS } } as never);
    render(<PreferencesCard />);

    const zone = screen.getByLabelText<HTMLSelectElement>('Time zone');
    expect(zone.value).toBe('Europe/Belgrade');
    fireEvent.change(zone, { target: { value: 'Europe/London' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ timezone: 'Europe/London' }));
  });

  it('offers the device’s zone when it differs from the account’s', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Tokyo' }) }) as never,
    );
    const update = vi
      .spyOn(api.me, 'update')
      .mockResolvedValue({ user: { id: 'me', timezone: 'Asia/Tokyo', prefs: DEFAULT_PREFS } } as never);
    render(<PreferencesCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Use this device’s zone (Asia/Tokyo)' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ timezone: 'Asia/Tokyo' }));
  });

  it('says so when a save did not go through, and leaves the zone alone', async () => {
    vi.spyOn(api.me, 'update').mockRejectedValue(new Error('nope'));
    render(<PreferencesCard />);
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
    expect(await screen.findByText('That did not save. Try again.')).toBeTruthy();
  });
});

describe('language and input', () => {
  it('says why there is nothing to set where the server cannot translate', () => {
    render(<PreferencesCard />);
    expect(screen.getByText(/Not configured on this server/)).toBeTruthy();
    expect(screen.queryByLabelText('Preferred language')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Auto-translate incoming messages' })).toBeNull();
  });

  it('cannot auto-translate until there is a language to translate into', () => {
    seed({}, true);
    render(<PreferencesCard />);
    const auto = screen.getByRole('switch', { name: 'Auto-translate incoming messages' });
    expect(auto.getAttribute('aria-disabled')).toBe('true');

    fireEvent.change(screen.getByLabelText('Preferred language'), { target: { value: 'de' } });
    expect(setPrefs).toHaveBeenCalledWith({ language: 'de', autoTranslate: false });
    const enabled = screen.getByRole('switch', { name: 'Auto-translate incoming messages' });
    expect(enabled.getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(enabled);
    expect(setPrefs).toHaveBeenLastCalledWith({ autoTranslate: true });
  });

  it('turns Enter-to-send off on the switch', () => {
    render(<PreferencesCard />);
    const enter = screen.getByRole('switch', { name: 'Enter sends a message' });
    expect(enter.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(enter);
    expect(setPrefs).toHaveBeenCalledWith({ enterToSend: false });
    expect(
      screen.getByRole('switch', { name: 'Enter sends a message' }).getAttribute('aria-checked'),
    ).toBe('false');
  });
});
