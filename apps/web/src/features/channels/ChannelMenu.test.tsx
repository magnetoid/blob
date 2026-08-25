// @vitest-environment happy-dom
/** The channel's own actions.
 *
 * Every one of these calls a route that has existed since before there was a control
 * for it, so what is worth pinning is not that the calls happen but that the *right*
 * ones are offered: a DM has no notification level to set and cannot be left or
 * archived, and only an admin is shown archiving. Offering an action the server will
 * refuse is the failure mode this menu is closest to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChannelWithState, UserRole } from '@blob/shared';
import { ChannelMenu } from './ChannelMenu.tsx';

const setMembership = vi.fn(async () => ({}));
const archive = vi.fn(async () => ({ ok: true as const }));
const leaveChannel = vi.fn(async () => {});
let role: UserRole = 'member';

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      channels: {
        setMembership: (...args: unknown[]) => setMembership(...(args as [])),
        archive: (...args: unknown[]) => archive(...(args as [])),
      },
    },
  };
});

vi.mock('../../lib/store.ts', () => ({
  useStore: (select: (state: unknown) => unknown) =>
    select({ currentUser: { id: 'u1', role }, leaveChannel }),
}));

function channel(overrides: Partial<ChannelWithState> = {}): ChannelWithState {
  return {
    id: 'c1',
    kind: 'public',
    name: 'general',
    topic: null,
    archivedAt: null,
    membership: { notifyLevel: 'mentions', isStarred: false },
    ...overrides,
  } as ChannelWithState;
}

function open(overrides: Partial<ChannelWithState> = {}) {
  const onClose = vi.fn();
  const onOpenDetails = vi.fn();
  render(
    <ChannelMenu
      channel={channel(overrides)}
      onClose={onClose}
      onOpenDetails={onOpenDetails}
    />,
  );
  return { onClose, onOpenDetails };
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'member';
});
afterEach(cleanup);

describe('notifications', () => {
  it('shows which level is set', () => {
    open({ membership: { notifyLevel: 'none', isStarred: false } } as Partial<ChannelWithState>);
    expect(screen.getByRole('menuitemradio', { name: /Nothing/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      screen.getByRole('menuitemradio', { name: /Mentions/ }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('mutes by setting the level the server actually honours', () => {
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Nothing/ }));
    // 'none' is the value notify.decide skips a recipient on. Anything else here would
    // be a control that looks like muting and notifies you anyway.
    expect(setMembership).toHaveBeenCalledWith('c1', { notifyLevel: 'none' });
  });

  it('is not offered for a direct message', () => {
    open({ kind: 'dm', name: null });
    expect(screen.queryByText('Notifications')).toBeNull();
  });
});

describe('starring', () => {
  it('offers to star one that is not', () => {
    open();
    fireEvent.click(screen.getByText('Star this channel'));
    expect(setMembership).toHaveBeenCalledWith('c1', { isStarred: true });
  });

  it('offers to unstar one that is', () => {
    open({ membership: { notifyLevel: 'mentions', isStarred: true } } as Partial<ChannelWithState>);
    fireEvent.click(screen.getByText('Remove from starred'));
    expect(setMembership).toHaveBeenCalledWith('c1', { isStarred: false });
  });

  it('is offered on a direct message too', () => {
    // The sidebar sorts DMs and channels by the same flag, so refusing here would
    // leave one list half-sortable for no reason the reader could see.
    open({ kind: 'dm', name: null });
    expect(screen.getByText('Star this channel')).toBeTruthy();
  });
});

describe('what is offered to whom', () => {
  it('does not offer to leave or archive a direct message', () => {
    open({ kind: 'dm', name: null });
    // Both are 403 on the server: you cannot leave a DM and you cannot archive one.
    expect(screen.queryByText('Leave channel')).toBeNull();
    expect(screen.queryByText('Archive channel')).toBeNull();
  });

  it('offers archiving to an admin and not to a member', () => {
    open();
    expect(screen.queryByText('Archive channel')).toBeNull();
    cleanup();

    role = 'admin';
    open();
    expect(screen.getByText('Archive channel')).toBeTruthy();
  });

  it('does not offer to archive one that already is', () => {
    role = 'owner';
    open({ archivedAt: '2026-01-01T00:00:00.000Z' });
    expect(screen.queryByText('Archive channel')).toBeNull();
    // Leaving still works: an archived channel is read-only, not gone.
    expect(screen.getByText('Leave channel')).toBeTruthy();
  });
});

describe('leaving', () => {
  it('asks first, and says what leaving a private one costs', () => {
    open({ kind: 'private', name: 'secret-plans' });
    fireEvent.click(screen.getByText('Leave channel'));
    expect(screen.getByText('Leave #secret-plans?')).toBeTruthy();
    expect(screen.getByText(/will not be able to find it again/)).toBeTruthy();
    expect(leaveChannel).not.toHaveBeenCalled();
  });

  it('leaves once confirmed', () => {
    open();
    fireEvent.click(screen.getByText('Leave channel'));
    fireEvent.click(screen.getByText('Leave'));
    expect(leaveChannel).toHaveBeenCalledWith('c1');
  });
});
