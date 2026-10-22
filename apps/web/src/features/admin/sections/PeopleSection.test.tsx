// @vitest-environment happy-dom
/** Who is offered a reset link and a sign-out, by the viewer's standing and the target's.
 *
 * The server decides (services/admin `_may_act_on`); this keeps the page from offering a
 * button that can only ever answer 403. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AdminUser } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';

const person = (id: string, role: AdminUser['role'], displayName: string): AdminUser => ({
  id,
  email: `${id}@example.com`,
  displayName,
  fullName: null,
  title: null,
  role,
  deactivatedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-09T00:00:00.000Z',
  sessionCount: 2,
  channelCount: 1,
  messageCount: 1,
  twoStep: false,
  placeholder: false,
  invitable: false,
});

const PEOPLE = [
  { ...person('own', 'owner', 'Olive Owner'), twoStep: true },
  person('adm', 'admin', 'Adam Admin'),
  { ...person('mem', 'member', 'Mia Member'), twoStep: true },
  person('me', 'admin', 'Me Myself'),
];

vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: { ...actual.api.admin, users: vi.fn(async () => ({ users: PEOPLE, total: 4 })) },
    },
  };
});

const { PeopleSection } = await import('./PeopleSection.tsx');

afterEach(cleanup);

async function offered(props: { isOwner: boolean; isInstanceAdmin?: boolean }) {
  useStore.setState({ currentUser: { ...useStore.getState().currentUser, id: 'me' } as never });
  render(<PeopleSection onError={vi.fn()} {...props} />);
  await screen.findByText('Mia Member');
  const names = (label: RegExp) =>
    screen.queryAllByRole('button', { name: label }).map((b) => b.getAttribute('aria-label'));
  return {
    reset: names(/^Make a password reset link for /),
    signOut: names(/^Sign out .*: \d+ sessions?$/),
    endTwoStep: names(/^End two-step for .*: stop asking for a passkey$/),
  };
}

describe('two-step sign-in', () => {
  it('shows who has it, and offers to end it under the reset link’s rule', async () => {
    const asAdmin = await offered({ isOwner: false });
    expect(screen.getAllByText('two-step')).toHaveLength(2);
    // A member's is any admin's to end; the owner's only the server administrator's.
    expect(asAdmin.endTwoStep).toEqual(['End two-step for Mia Member: stop asking for a passkey']);
    cleanup();

    const asServerAdmin = await offered({ isOwner: false, isInstanceAdmin: true });
    expect(asServerAdmin.endTwoStep).toEqual([
      'End two-step for Olive Owner: stop asking for a passkey',
      'End two-step for Mia Member: stop asking for a passkey',
    ]);
  });
});

describe('what an admin is offered on each row', () => {
  it('lets a plain admin act on members, and sign only themselves out besides', async () => {
    const { reset, signOut } = await offered({ isOwner: false });
    expect(reset).toEqual(['Make a password reset link for Mia Member']);
    expect(signOut).toEqual(['Sign out Mia Member: 2 sessions', 'Sign out Me Myself: 2 sessions']);
  });

  it('lets the owner act on admins too, but not on the owner', async () => {
    const { reset } = await offered({ isOwner: true });
    expect(reset).not.toContain('Make a password reset link for Olive Owner');
    expect(reset).toContain('Make a password reset link for Adam Admin');
  });

  it('lets the server’s administrator act on everyone', async () => {
    const { reset } = await offered({ isOwner: false, isInstanceAdmin: true });
    expect(reset).toContain('Make a password reset link for Olive Owner');
  });
});
