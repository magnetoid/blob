// @vitest-environment happy-dom
/** The parts of the People page are reached by their old URLs too — `/admin/groups`,
 * `/admin/invitations`, `/admin/users` — and they draw their contents and leave the card
 * to whoever shows them. What these pin: alone, a part still gets its card; Groups' own
 * detail page (one group's members) draws its own and is not framed a second time; and
 * a detail id on a part with no detail page — `/admin/users/:id` — changes nothing.
 *
 * And the nav, as this console mounts it: one list under no heading, offering each page
 * to whoever the server lets in — read off the signed-in person, not off their role
 * alone. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { useStore } from '../../lib/store.ts';

vi.mock('../shell/TopBar.tsx', () => ({ TopBar: () => <div>top bar</div> }));
vi.mock('./sections/GroupsSection.tsx', () => ({
  GroupsSection: (p: { detailId?: string }) => (
    <div>groups-part{p.detailId ? `:${p.detailId}` : ''}</div>
  ),
}));
vi.mock('./sections/InvitationsSection.tsx', () => ({
  InvitationsSection: () => <div>invitations-part</div>,
}));
vi.mock('./sections/AccountsSection.tsx', () => ({
  AccountsSection: () => <div>accounts-part</div>,
}));

const { AdminConsole } = await import('./AdminConsole.tsx');

afterEach(() => {
  cleanup();
  useStore.setState({ currentUser: null });
});

describe('a People part at its old URL', () => {
  it('sits in the card the People page would give it', () => {
    render(<AdminConsole section="invitations" onFeedback={vi.fn()} />);
    expect(screen.getByText('invitations-part').closest('.console-card')).toBeTruthy();
  });

  it('is not framed again when it is a detail page that draws its own', () => {
    render(<AdminConsole section="groups" detailId="g1" onFeedback={vi.fn()} />);
    expect(screen.getByText('groups-part:g1').closest('.console-card')).toBeNull();
  });

  // Accounts shows its list whatever follows /admin/users/, so the list keeps its card —
  // the bypass above was once taken for any detail id, and this page lost its frame.
  it('keeps its card under a detail id when it has no detail page', () => {
    render(<AdminConsole section="users" detailId="u1" onFeedback={vi.fn()} />);
    expect(screen.getByText('accounts-part').closest('.console-card')).toBeTruthy();
  });
});

describe('the console’s nav', () => {
  function signIn(role: 'admin' | 'owner', isInstanceAdmin: boolean) {
    useStore.setState({
      currentUser: { id: 'me', role, isInstanceAdmin } as never,
    });
  }

  function navRows(): string[] {
    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    expect(within(nav).queryAllByRole('heading')).toEqual([]);
    return [...nav.querySelectorAll('.channel-name')].map((node) => node.textContent ?? '');
  }

  it('is one list, with the server’s pages for the person who runs it', () => {
    signIn('owner', true);
    render(<AdminConsole section="invitations" onFeedback={vi.fn()} />);
    expect(navRows()).toEqual([
      'General',
      'Appearance',
      'People',
      'Channels',
      'Emoji',
      'Huddles',
      'Video meetups',
      'Apps & agents',
      'Janus',
      'MCP servers',
      'Usage',
      'Approvals',
      'Export',
      'Import',
      'Security',
      'Retention',
      'Webhooks',
      'Deliveries',
      'Assistants',
      'Single sign-on',
      'App policy',
      'Health',
      'Audit log',
      'Errors and logs',
      'Feedback',
    ]);
  });

  it('leaves the server’s pages off for an owner who does not run the server', () => {
    signIn('owner', false);
    render(<AdminConsole section="invitations" onFeedback={vi.fn()} />);
    const rows = navRows();
    expect(rows).not.toContain('App policy');
    expect(rows).not.toContain('Single sign-on');
    expect(rows).not.toContain('Errors and logs');
    expect(rows).toContain('Health');
    expect(rows).toHaveLength(22);
  });

  it('gives them to the server’s admin when they are a plain admin here', () => {
    signIn('admin', true);
    render(<AdminConsole section="invitations" onFeedback={vi.fn()} />);
    expect(navRows()).toContain('Errors and logs');
    expect(navRows()).toHaveLength(25);
  });
});
