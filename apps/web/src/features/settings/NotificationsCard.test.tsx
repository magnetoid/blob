// @vitest-environment happy-dom
/** Settings → Notifications: how often Blob may email you while you are away (ADR 0036),
 * and the switches and choices that decide when it may interrupt you. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_PREFS, type UserPrefs } from '@blob/shared';

vi.mock('../../lib/push.ts', () => ({
  currentPushState: vi.fn(async () => 'unsupported'),
  disablePush: vi.fn(),
  enablePush: vi.fn(),
  needsIosInstall: () => false,
}));

const { NotificationsCard } = await import('./NotificationsCard.tsx');
const { useStore } = await import('../../lib/store.ts');
const { api } = await import('../../lib/api.ts');

/** What the store's own action does once a save has gone through: the preference lands in
 * the user, which is what every control here draws itself from. */
const setPrefs = vi.fn(async (patch: Partial<UserPrefs>) => {
  useStore.setState((s) => ({
    currentUser: s.currentUser && {
      ...s.currentUser,
      prefs: { ...s.currentUser.prefs, ...patch },
    },
  }));
});

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'me', displayName: 'Ana', prefs: { ...DEFAULT_PREFS } } as never,
    setPrefs,
    groups: {},
    myGroupIds: new Set(),
    mutedGroupIds: new Set(),
  } as never);
});

afterEach(() => {
  cleanup();
  setPrefs.mockClear();
  vi.restoreAllMocks();
});

describe('email when away', () => {
  it('starts where Slack does, every fifteen minutes', () => {
    render(<NotificationsCard />);
    const choice = screen.getByLabelText<HTMLSelectElement>("Email me when I'm away");
    expect(choice.value).toBe('quarter_hour');
  });

  it('saves a choice', () => {
    render(<NotificationsCard />);
    fireEvent.change(screen.getByLabelText("Email me when I'm away"), {
      target: { value: 'off' },
    });
    expect(setPrefs).toHaveBeenCalledWith({ emailWhenAway: 'off' });
  });
});

describe('the switches', () => {
  it('toggles a notification switch from the keyboard and saves it', () => {
    render(<NotificationsCard />);
    const quietHours = screen.getByRole('switch', { name: 'Quiet hours' });
    expect(quietHours.getAttribute('aria-checked')).toBe('false');

    // A switch has no native button under it. Focus it, and Space — pressed on keydown,
    // acted on when the key comes back up — is all a keyboard has.
    quietHours.focus();
    expect(document.activeElement).toBe(quietHours);
    fireEvent.keyDown(quietHours, { key: ' ', code: 'Space' });
    fireEvent.keyUp(quietHours, { key: ' ', code: 'Space' });

    expect(setPrefs).toHaveBeenCalledTimes(1);
    // The window it will notify in rides along: the server holds the whole of it.
    expect(setPrefs).toHaveBeenCalledWith({ dnd: expect.objectContaining({ enabled: true }) });
    expect(screen.getByRole('switch', { name: 'Quiet hours' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('answers a click on its label as it answers a click on itself', () => {
    render(<NotificationsCard />);
    fireEvent.click(screen.getByText('Nudge me about unanswered questions'));
    expect(setPrefs).toHaveBeenCalledWith({ nudges: false });
  });

  it('asks for the quiet hours’ window only once they are on', () => {
    render(<NotificationsCard />);
    expect(screen.queryByLabelText('Notify me from')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    const from = screen.getByLabelText<HTMLSelectElement>('Notify me from');
    expect(from.value).toBe('9');
    fireEvent.change(from, { target: { value: '7' } });
    expect(setPrefs).toHaveBeenLastCalledWith({
      dnd: expect.objectContaining({ enabled: true, startHour: 7 }),
    });

    // The days are a set of presses, not a choice of one.
    fireEvent.click(screen.getByRole('button', { name: 'Mon', pressed: true }));
    expect(setPrefs).toHaveBeenLastCalledWith({
      dnd: expect.objectContaining({ days: [2, 3, 4, 5] }),
    });
    expect(screen.getByRole('button', { name: 'Mon', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sun', pressed: false })).toBeTruthy();
  });
});

describe('pausing notifications', () => {
  it('offers the presets until one is chosen, then only the way back', () => {
    const before = Date.now();
    render(<NotificationsCard />);
    fireEvent.click(screen.getByRole('button', { name: '1 hour' }));

    const until = new Date(setPrefs.mock.calls[0]![0].snoozeUntil!).getTime();
    expect(until - before).toBeGreaterThanOrEqual(60 * 60_000);
    expect(until - before).toBeLessThan(61 * 60_000);

    expect(screen.queryByRole('button', { name: '1 hour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(setPrefs).toHaveBeenLastCalledWith({ snoozeUntil: null });
  });
});

describe('keyword alerts', () => {
  it('adds a word, and removes it by pressing it', () => {
    render(<NotificationsCard />);
    fireEvent.change(screen.getByLabelText('Add a keyword to be alerted on'), {
      target: { value: 'deploy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(setPrefs).toHaveBeenLastCalledWith({ keywords: ['deploy'] });

    // The ✕ is decoration, so the button is named for the word alone.
    fireEvent.click(screen.getByRole('button', { name: 'deploy', pressed: true }));
    expect(setPrefs).toHaveBeenLastCalledWith({ keywords: [] });
  });
});

describe('group mentions', () => {
  it('draws a group as on until it is muted, and mutes it on the switch', async () => {
    const setMuted = vi.spyOn(api.groups, 'setMuted').mockResolvedValue({ ok: true } as never);
    useStore.setState({
      groups: { g1: { id: 'g1', handle: 'design', name: 'Design' } },
      myGroupIds: new Set(['g1']),
    } as never);
    render(<NotificationsCard />);

    const mention = screen.getByRole('switch', { name: 'Notifications for @design' });
    expect(mention.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Design')).toBeTruthy();

    fireEvent.click(mention);
    await waitFor(() => expect(setMuted).toHaveBeenCalledWith('g1', true));
    expect(
      screen.getByRole('switch', { name: 'Notifications for @design' }).getAttribute('aria-checked'),
    ).toBe('false');
  });
});
