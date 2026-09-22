// @vitest-environment happy-dom
/** User groups. What these pin is what a screen reader gets: at the old `/admin/groups`
 * URL the page's outline runs h1 → h2 (the card there has no title, and a fixed h3 made
 * it skip a level), and the field that renames a group has a name — it replaces the
 * group's name in its cell, so nothing on screen labels it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { api } from '../../../lib/api.ts';

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

afterEach(cleanup);

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
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'New name for @platform-team' });
    expect((field as HTMLInputElement).value).toBe('Platform Team');
  });
});
