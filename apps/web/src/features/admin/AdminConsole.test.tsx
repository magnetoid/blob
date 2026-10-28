// @vitest-environment happy-dom
/** The parts of the People page are reached by their old URLs too — `/admin/groups`,
 * `/admin/invitations` — and they draw their contents and leave the card to whoever
 * shows them. What these pin: alone, a part still gets its card; Groups' own detail page
 * (one group's members) draws its own and is not framed a second time.
 *
 * And the nav, as this console mounts it: three groups under their headings, the same
 * for every admin — the machine's pages are the server console's now. */
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
});

describe('the console’s nav', () => {
  function signIn(role: 'admin' | 'owner', isInstanceAdmin: boolean) {
    useStore.setState({
      currentUser: { id: 'me', role, isInstanceAdmin } as never,
    });
  }

  function nav() {
    const node = screen.getByRole('navigation', { name: 'Console sections' });
    return {
      headings: within(node).queryAllByRole('heading').map((h) => h.textContent),
      rows: [...node.querySelectorAll('.channel-name')].map((n) => n.textContent ?? ''),
    };
  }

  const ROWS = [
    'General', 'Appearance', 'People', 'Channels', 'Emoji', 'Calls', 'Feedback',
    'Apps & agents', 'Janus', 'MCP servers', 'Usage', 'Approvals', 'Webhooks', 'Deliveries',
    'Assistants',
    'Export', 'Import', 'Retention', 'Security', 'Audit log',
  ];

  it('is three groups, the workspace’s pages and nothing of the machine’s', () => {
    signIn('owner', true);
    render(<AdminConsole section="invitations" onFeedback={vi.fn()} />);
    expect(nav()).toEqual({
      headings: ['Workspace', 'Apps & agents', 'Data & security'],
      rows: ROWS,
    });
  });

  it('is the same for an admin, an owner, and the person who runs the server', () => {
    for (const [role, instance] of [['admin', false], ['owner', false], ['admin', true]] as const) {
      signIn(role, instance);
      const { unmount } = render(<AdminConsole section="general" onFeedback={vi.fn()} />);
      expect(nav().rows).toEqual(ROWS);
      unmount();
    }
  });

  it('calls the page what it is', () => {
    signIn('admin', false);
    render(<AdminConsole section="general" onFeedback={vi.fn()} />);
    expect(screen.getByText('This workspace')).toBeTruthy();
    expect(screen.getByText('You are an admin of this workspace.')).toBeTruthy();
  });
});
