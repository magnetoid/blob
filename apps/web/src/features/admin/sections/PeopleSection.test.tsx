// @vitest-environment happy-dom
/** Who is offered a reset link and a sign-out, by the viewer's standing and the target's.
 *
 * The server decides (services/admin `_may_act_on`); this keeps the page from offering a
 * button that can only ever answer 403. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const { resetLink, setRole, users } = vi.hoisted(() => ({
  resetLink: vi.fn(async () => ({ url: 'https://blob.example/reset/abc', expiresAt: '' })),
  setRole: vi.fn(async () => ({})),
  users: vi.fn(),
}));

vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: { ...actual.api.admin, users, resetLink, setRole },
    },
  };
});

const { PeopleSection } = await import('./PeopleSection.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  users.mockImplementation(async () => ({ users: PEOPLE, total: 4 }));
});

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

describe('the directory', () => {
  it('is a list of people, each with what they are and what they have done', async () => {
    await offered({ isOwner: false });
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    const mia = within(rows[2]!);
    expect(mia.getByText('Mia Member')).toBeTruthy();
    expect(mia.getByText(/mem@example\.com · 1 messages · 1 channels · seen /)).toBeTruthy();
    // A role other than member is said beside the name.
    expect(within(rows[0]!).getByText('owner')).toBeTruthy();
  });

  it('searches by name or address, and says what it asked for when nobody matched', async () => {
    await offered({ isOwner: false });
    users.mockImplementation(async () => ({ users: [], total: 0 }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search people' }), { target: { value: 'zed' } });
    expect(await screen.findByText('Nobody matched “zed”.')).toBeTruthy();
    expect(users).toHaveBeenLastCalledWith({ q: 'zed' });
  });

  it('lets only the owner change a role, and not their own', async () => {
    await offered({ isOwner: true });
    const role = screen.getByRole('combobox', { name: 'Role for Mia Member' }) as HTMLSelectElement;
    expect(role.value).toBe('member');
    expect(screen.queryByRole('combobox', { name: 'Role for Me Myself' })).toBeNull();

    fireEvent.change(role, { target: { value: 'admin' } });
    await waitFor(() => expect(setRole).toHaveBeenCalledWith('mem', 'admin'));
    cleanup();

    await offered({ isOwner: false });
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows a reset link once, in a field of its own, named for whom it is for', async () => {
    await offered({ isOwner: false });
    fireEvent.click(screen.getByRole('button', { name: 'Make a password reset link for Mia Member' }));

    const link = (await screen.findByRole('textbox', {
      name: 'Password reset link for Mia Member',
    })) as HTMLInputElement;
    expect(link.value).toBe('https://blob.example/reset/abc');
    expect(screen.getByText(/good for an hour/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('textbox', { name: /^Password reset link/ })).toBeNull();
  });
});
