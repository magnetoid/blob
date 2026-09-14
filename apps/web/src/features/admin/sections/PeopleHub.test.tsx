// @vitest-environment happy-dom
/** Four pages became one. What these pin: the four parts are there, in the order a
 * person is dealt with; Accounts is the owner's alone; and a member's detail id opens
 * only the member — never handed to the parts it does not belong to. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('./PeopleSection.tsx', () => ({
  PeopleSection: (p: { detailId?: string }) => <div>members-part{p.detailId ? `:${p.detailId}` : ''}</div>,
}));
vi.mock('./GroupsSection.tsx', () => ({ GroupsSection: () => <div>groups-part</div> }));
vi.mock('./InvitationsSection.tsx', () => ({ InvitationsSection: () => <div>invitations-part</div> }));
vi.mock('./AccountsSection.tsx', () => ({ AccountsSection: () => <div>accounts-part</div> }));

const { PeopleHub } = await import('./PeopleHub.tsx');

afterEach(cleanup);

describe('the People page', () => {
  it('shows members, groups, invitations and — for the owner — accounts', () => {
    render(<PeopleHub onError={vi.fn()} isOwner />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Members', 'User groups', 'Invitations', 'Accounts']);
    expect(screen.getByText('accounts-part')).toBeTruthy();
  });

  it('keeps accounts off an admin who does not own the server', () => {
    render(<PeopleHub onError={vi.fn()} isOwner={false} />);
    expect(screen.queryByText('accounts-part')).toBeNull();
    expect(screen.getByText('invitations-part')).toBeTruthy();
  });

  it('opens one member for a detail id, and nothing else', () => {
    render(<PeopleHub onError={vi.fn()} isOwner detailId="u42" />);
    expect(screen.getByText('members-part:u42')).toBeTruthy();
    expect(screen.queryByText('groups-part')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});
