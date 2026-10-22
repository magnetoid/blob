// @vitest-environment happy-dom
/**
 * Somebody a Slack import brought over (ADR 0042) is not a deactivated member: they have
 * not joined yet, and the way in is an invitation to their address — never Reactivate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUser } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';

const person = (id: string, displayName: string, extra: Partial<AdminUser> = {}): AdminUser => ({
  id,
  email: `${id}@example.com`,
  displayName,
  fullName: null,
  title: null,
  role: 'member',
  deactivatedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: null,
  sessionCount: 0,
  channelCount: 3,
  messageCount: 12,
  twoStep: false,
  placeholder: false,
  invitable: false,
  ...extra,
});

const PEOPLE = [
  person('pat', 'Pat Lee', { deactivatedAt: '2026-10-22T00:00:00.000Z', placeholder: true, invitable: true }),
  person('app', 'deploy-bot', { deactivatedAt: '2026-10-22T00:00:00.000Z', placeholder: true }),
  person('gone', 'Gone Member', { deactivatedAt: '2026-09-01T00:00:00.000Z' }),
];

const { createInvite } = vi.hoisted(() => ({
  createInvite: vi.fn(async () => ({ url: 'https://blob.example/join/t', expiresAt: '', emailed: true })),
}));

vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, createInvite },
      admin: { ...actual.api.admin, users: vi.fn(async () => ({ users: PEOPLE, total: 3 })) },
    },
  };
});

const { PeopleSection } = await import('./PeopleSection.tsx');

afterEach(cleanup);

describe('people an import brought over', () => {
  it('says they have not joined, and offers an invitation instead of Reactivate', async () => {
    useStore.setState({ currentUser: { ...useStore.getState().currentUser, id: 'me' } as never });
    render(<PeopleSection onError={vi.fn()} isOwner />);
    const pat = (await screen.findByText('Pat Lee')).closest('.admin-row') as HTMLElement;
    expect(pat.textContent).toContain('not joined yet');
    expect(pat.textContent).not.toContain('deactivated');
    expect(screen.queryByRole('button', { name: 'Reactivate Pat Lee' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Invite Pat Lee' }));
    await waitFor(() => expect(createInvite).toHaveBeenCalledWith({ email: 'pat@example.com' }));

    // An app, or an address the export did not have, is a name and nothing to invite —
    // and its made-up address is not shown as if it were one.
    expect(screen.queryByRole('button', { name: 'Invite deploy-bot' })).toBeNull();
    const app = screen.getByText('deploy-bot').closest('.admin-row') as HTMLElement;
    expect(app.textContent).toContain('from Slack');
    expect(app.textContent).toContain('no address');
    expect(app.textContent).not.toContain('app@example.com');
    // A member who was switched off is still that.
    expect(screen.getByRole('button', { name: 'Reactivate Gone Member' })).toBeTruthy();
  });
});
