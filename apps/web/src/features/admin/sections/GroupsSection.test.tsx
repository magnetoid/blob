// @vitest-environment happy-dom
/** User groups. What these pin is what a screen reader gets: at the old `/admin/groups`
 * URL the page's outline runs h1 → h2 (the card there has no title, and a fixed h3 made
 * it skip a level), and the field that renames a group has a name — it replaces the
 * group's name in its cell, so nothing on screen labels it. And what the page does: a
 * handle is cleaned before it is sent, the list is a table whose rows name their group,
 * and one group's members can be added to and removed from. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';

vi.mock('../../shell/TopBar.tsx', () => ({ TopBar: () => <div>top bar</div> }));

const { AdminConsole } = await import('../AdminConsole.tsx');
const { GroupsSection } = await import('./GroupsSection.tsx');

const GROUP = {
  id: 'g1',
  handle: 'platform-team',
  name: 'Platform Team',
  description: null,
  memberCount: 3,
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.spyOn(api.admin, 'groups').mockResolvedValue({ groups: [GROUP] });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('user groups', () => {
  it('at their old URL, go from the page’s h1 to an h2 without skipping a level', async () => {
    render(<AdminConsole section="groups" onFeedback={vi.fn()} />);
    const main = screen.getByRole('main');
    await within(main).findByText('@platform-team');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe('User groups');
    expect(within(main).getByRole('heading', { level: 2, name: 'New group' })).toBeTruthy();
    expect(within(main).queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('name the field that renames one after the group', async () => {
    render(<GroupsSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename @platform-team' }));
    const field = screen.getByRole('textbox', { name: 'New name for @platform-team' });
    expect((field as HTMLInputElement).value).toBe('Platform Team');
  });

  it('are a table: a column for what each is called, and a row that names its group', async () => {
    render(<GroupsSection onError={vi.fn()} isOwner />);
    const table = await screen.findByRole('table', { name: 'User groups' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Handle',
      'Name',
      'People',
      'Actions',
    ]);
    const row = within(table).getByRole('row', { name: /@platform-team/ });
    expect(within(row).getByText('Platform Team')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Members of @platform-team' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Delete @platform-team' })).toBeTruthy();
  });

  it('say so when there are none', async () => {
    vi.spyOn(api.admin, 'groups').mockResolvedValue({ groups: [] });
    render(<GroupsSection onError={vi.fn()} isOwner />);
    expect(await screen.findByText('None yet.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'User groups' })).toBeNull();
  });

  it('send a handle without its @ or capitals, and hold Create until it would be accepted', async () => {
    const create = vi.spyOn(api.admin, 'createGroup').mockResolvedValue({ group: GROUP } as never);
    render(<GroupsSection onError={vi.fn()} isOwner />);
    await screen.findByRole('table', { name: 'User groups' });
    const createButton = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Handle' }), { target: { value: '@Design-Crew' } });
    expect(createButton.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: ' Design Crew ' } });
    expect(createButton.disabled).toBe(false);
    // The words the handle will be written with, as the person typed it.
    expect(screen.getByText('@design-crew')).toBeTruthy();

    fireEvent.click(createButton);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ handle: 'design-crew', name: 'Design Crew' }),
    );
  });

  it('say what a handle may be, as the hint of the field that is wrong', async () => {
    render(<GroupsSection onError={vi.fn()} isOwner />);
    await screen.findByRole('table', { name: 'User groups' });
    const handle = screen.getByRole('textbox', { name: 'Handle' });
    expect(handle.getAttribute('aria-invalid')).toBeNull();

    fireEvent.change(handle, { target: { value: 'A' } });
    expect(
      screen.getByRole('textbox', {
        name: 'Handle',
        description: /Two to thirty-two characters: lowercase letters, numbers and hyphens/,
      }),
    ).toBeTruthy();
    expect(handle.getAttribute('aria-invalid')).toBe('true');
  });

  it('open one group’s members at its own URL', async () => {
    render(<GroupsSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Members of @platform-team' }));
    expect(window.location.pathname).toBe('/admin/groups/g1');
  });
});

describe('one group’s members', () => {
  const ADA = { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, kind: 'human', deactivated: false };
  const BOB = { id: 'u2', displayName: 'Bob Barker', avatarUrl: null, kind: 'human', deactivated: false };
  const BOT = { id: 'u3', displayName: 'Bobbot', avatarUrl: null, kind: 'bot', deactivated: false };

  beforeEach(() => {
    useStore.setState({ users: { u1: ADA, u2: BOB, u3: BOT } } as never);
    vi.spyOn(api.admin, 'groupMembers').mockResolvedValue({ userIds: ['u1'] });
  });

  it('are the group’s card, titled with its handle, each with a Remove that names them', async () => {
    const remove = vi.spyOn(api.admin, 'removeGroupMember').mockResolvedValue(undefined as never);
    render(<GroupsSection onError={vi.fn()} isOwner detailId="g1" />);
    expect(await screen.findByRole('heading', { name: '@platform-team' })).toBeTruthy();

    const member = screen.getByText('Ada Lovelace').closest('[role="listitem"]') as HTMLElement;
    fireEvent.click(within(member).getByRole('button', { name: 'Remove Ada Lovelace from the group' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('g1', 'u1'));
  });

  it('offer people by what is typed — not those already in, and never a bot — and add the one picked', async () => {
    const add = vi.spyOn(api.admin, 'addGroupMember').mockResolvedValue(undefined as never);
    render(<GroupsSection onError={vi.fn()} isOwner detailId="g1" />);
    await screen.findByText('Ada Lovelace');

    fireEvent.change(screen.getByRole('textbox', { name: 'Add someone' }), { target: { value: 'bob' } });
    // Bobbot is a bot, and a group mention notifies through membership.
    expect(screen.queryByRole('button', { name: /Bobbot/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Bob Barker/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('g1', 'u2'));
  });

  it('say when nobody is in, and lead back to the list', async () => {
    vi.spyOn(api.admin, 'groupMembers').mockResolvedValue({ userIds: [] });
    render(<GroupsSection onError={vi.fn()} isOwner detailId="g1" />);
    expect(await screen.findByText('Nobody is in this group yet.')).toBeTruthy();

    window.history.replaceState(null, '', '/admin/groups/g1');
    fireEvent.click(screen.getByRole('button', { name: 'All groups' }));
    expect(window.location.pathname).toBe('/admin/groups');
  });
});
