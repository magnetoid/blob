// @vitest-environment happy-dom
/** The parts of the People page are reached by their old URLs too — `/admin/groups`,
 * `/admin/invitations`, `/admin/users` — and they draw their contents and leave the card
 * to whoever shows them. What these pin: alone, a part still gets its card; Groups' own
 * detail page (one group's members) draws its own and is not framed a second time; and
 * a detail id on a part with no detail page — `/admin/users/:id` — changes nothing. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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

afterEach(cleanup);

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
