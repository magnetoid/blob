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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChannelWithState, UserRole } from '@blob/shared';
import ChannelMenu from './ChannelMenu.tsx';
import '../../test/overlayChunk.ts';

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
    select({
      currentUser: { id: 'u1', role, prefs: { sidebarSections: [] } },
      leaveChannel,
      channelTitle: (c: { name: string }) => `#${c.name}`,
      setSidebarSections: vi.fn(),
    }),
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

function open(overrides: Partial<ChannelWithState> = {}, props: { onOpenRuns?: () => void } = {}) {
  const onOpenDetails = vi.fn();
  render(
    <ChannelMenu
      trigger={<button type="button">Options</button>}
      defaultOpen
      channel={channel(overrides)}
      onOpenDetails={onOpenDetails}
      {...props}
    />,
  );
  return { onOpenDetails };
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'member';
});
afterEach(cleanup);

describe('notifications', () => {
  it('shows which level is set', async () => {
    open({ membership: { notifyLevel: 'none', isStarred: false } } as Partial<ChannelWithState>);
    expect(
      (await screen.findByRole('menuitemradio', { name: /Nothing/ })).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: /Mentions/ }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('mutes by setting the level the server actually honours', async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Nothing/ }));
    // 'none' is the value notify.decide skips a recipient on. Anything else here would
    // be a control that looks like muting and notifies you anyway.
    expect(setMembership).toHaveBeenCalledWith('c1', { notifyLevel: 'none' });
  });

  it('is not offered for a direct message', async () => {
    open({ kind: 'dm', name: null });
    await screen.findByRole('menuitem', { name: 'Star this channel' });
    expect(screen.queryByText('Notifications')).toBeNull();
  });
});

describe('starring', () => {
  it('offers to star one that is not', async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Star this channel' }));
    expect(setMembership).toHaveBeenCalledWith('c1', { isStarred: true });
  });

  it('offers to unstar one that is', async () => {
    open({ membership: { notifyLevel: 'mentions', isStarred: true } } as Partial<ChannelWithState>);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from starred' }));
    expect(setMembership).toHaveBeenCalledWith('c1', { isStarred: false });
  });

  it('is offered on a direct message too', async () => {
    // The sidebar sorts DMs and channels by the same flag, so refusing here would
    // leave one list half-sortable for no reason the reader could see.
    open({ kind: 'dm', name: null });
    expect(await screen.findByRole('menuitem', { name: 'Star this channel' })).toBeTruthy();
  });
});

describe('what is offered to whom', () => {
  it('does not offer to leave or archive a direct message', async () => {
    open({ kind: 'dm', name: null });
    await screen.findByRole('menuitem', { name: 'Star this channel' });
    // Both are 403 on the server: you cannot leave a DM and you cannot archive one.
    expect(screen.queryByText('Leave channel')).toBeNull();
    expect(screen.queryByText('Archive channel')).toBeNull();
  });

  it('offers archiving to an admin and not to a member', async () => {
    open();
    await screen.findByRole('menuitem', { name: 'Leave channel' });
    expect(screen.queryByText('Archive channel')).toBeNull();
    cleanup();

    role = 'admin';
    open();
    expect(await screen.findByRole('menuitem', { name: 'Archive channel' })).toBeTruthy();
  });

  it('does not offer to archive one that already is', async () => {
    role = 'owner';
    open({ archivedAt: '2026-01-01T00:00:00.000Z' });
    // Leaving still works: an archived channel is read-only, not gone.
    expect(await screen.findByRole('menuitem', { name: 'Leave channel' })).toBeTruthy();
    expect(screen.queryByText('Archive channel')).toBeNull();
  });
});

describe('leaving', () => {
  it('asks first, and says what leaving a private one costs', async () => {
    open({ kind: 'private', name: 'secret-plans' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Leave channel' }));
    expect(await screen.findByText('Leave #secret-plans?')).toBeTruthy();
    expect(screen.getByText(/will not be able to find it again/)).toBeTruthy();
    expect(leaveChannel).not.toHaveBeenCalled();
  });

  it('leaves once confirmed', async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Leave channel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(leaveChannel).toHaveBeenCalledWith('c1');
  });

  it('closes the menu and keeps the dialog when Move to a section… is chosen', async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to a section…' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes only the dialog on Escape and returns focus to the trigger', async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Leave channel' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options' }));
    expect(leaveChannel).not.toHaveBeenCalled();
  });

  it('returns focus to the trigger after Cancel too', async () => {
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Leave channel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options' }));
  });
});

describe('the menu itself', () => {
  it('moves the highlight with ArrowDown and closes on Escape', async () => {
    open();
    const first = await screen.findByRole('menuitemradio', { name: /Every message/ });
    const menu = screen.getByRole('menu');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Mentions/ })),
    );
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('shows a failure inside the menu, as an alert, and keeps it open', async () => {
    setMembership.mockRejectedValueOnce(new Error('boom'));
    open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Star this channel' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That did not take.');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('opens the agent runs by the label it is given', async () => {
    const onOpenRuns = vi.fn();
    open({}, { onOpenRuns });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Agent runs' }));
    expect(onOpenRuns).toHaveBeenCalled();
  });
});
