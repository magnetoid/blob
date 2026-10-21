// @vitest-environment happy-dom
/** Settings → Notifications: how often Blob may email you while you are away (ADR 0036). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_PREFS } from '@blob/shared';

vi.mock('../../lib/push.ts', () => ({
  currentPushState: vi.fn(async () => 'unsupported'),
  disablePush: vi.fn(),
  enablePush: vi.fn(),
  needsIosInstall: () => false,
}));

const { NotificationsCard } = await import('./NotificationsCard.tsx');
const { useStore } = await import('../../lib/store.ts');

const setPrefs = vi.fn(async () => undefined);

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
