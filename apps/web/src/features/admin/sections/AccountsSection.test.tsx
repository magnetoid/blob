// @vitest-environment happy-dom
/**
 * The server's Accounts list: every account on the machine in one table, found by a name,
 * an address or a workspace, with the count above it. Bots are rows too — an app's bot is a
 * real user (ADR 0005), and an operator counting accounts should see what the database has.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { api, type InstanceUser } from '../../../lib/api.ts';
import { AccountsSection } from './AccountsSection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const user = (patch: Partial<InstanceUser>): InstanceUser => ({
  id: 'u1',
  email: 'olga@acme.example',
  displayName: 'Olga',
  role: 'owner',
  kind: 'human',
  workspaceId: 'w1',
  workspaceName: 'Acme',
  deactivated: false,
  createdAt: '2026-10-01T09:00:00Z',
  ...patch,
});

const USERS = [
  user({}),
  user({ id: 'u2', displayName: 'Max', email: 'max@globex.example', workspaceId: 'w2', workspaceName: 'Globex', role: 'member', deactivated: true }),
  user({ id: 'u3', displayName: 'Janus', email: 'janus@acme.example', kind: 'bot', role: 'member' }),
];

describe('the accounts list', () => {
  it('lists every account in a named table, with a bot marked and a deactivated one said so', async () => {
    vi.spyOn(api.admin, 'instanceUsers').mockResolvedValue({ users: USERS });
    render(<AccountsSection onError={vi.fn()} />);

    const table = await screen.findByRole('table', { name: 'Accounts' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Email', 'Workspace', 'Role', 'State']);

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const janus = rows.find((row) => within(row).queryByText('Janus'))!;
    expect(within(janus).getByText('App')).toBeTruthy();
    const max = rows.find((row) => within(row).queryByText('Max'))!;
    expect(within(max).getByText('Deactivated')).toBeTruthy();
    expect(within(max).getByText('Globex')).toBeTruthy();
    expect(within(rows.find((row) => within(row).queryByText('Olga'))!).getByText('Active')).toBeTruthy();
  });

  it('counts the accounts, humans and bots', async () => {
    vi.spyOn(api.admin, 'instanceUsers').mockResolvedValue({ users: USERS });
    render(<AccountsSection onError={vi.fn()} />);
    expect(await screen.findByText('3 accounts — 2 human, 1 bot.')).toBeTruthy();
  });

  it('says "1 account" for one', async () => {
    vi.spyOn(api.admin, 'instanceUsers').mockResolvedValue({ users: [USERS[0]!] });
    render(<AccountsSection onError={vi.fn()} />);
    expect(await screen.findByText('1 account — 1 human, 0 bot.')).toBeTruthy();
  });

  it('finds an account by name, address or workspace, and says when nothing matched', async () => {
    vi.spyOn(api.admin, 'instanceUsers').mockResolvedValue({ users: USERS });
    render(<AccountsSection onError={vi.fn()} />);
    const search = await screen.findByRole('textbox', { name: 'Find an account' });
    await screen.findByRole('table', { name: 'Accounts' });

    const names = () =>
      within(screen.getByRole('table', { name: 'Accounts' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]!.textContent);

    fireEvent.change(search, { target: { value: 'GLOBEX' } });
    expect(names()).toEqual(['Max']);
    fireEvent.change(search, { target: { value: 'janus@' } });
    expect(names()).toEqual(['Janus App']);
    fireEvent.change(search, { target: { value: 'olga' } });
    expect(names()).toEqual(['Olga']);

    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Nothing matched.')).toBeTruthy();
  });

  it('is not drawn as a legacy island: it is converted markup', async () => {
    vi.spyOn(api.admin, 'instanceUsers').mockResolvedValue({ users: USERS });
    const { container } = render(<AccountsSection onError={vi.fn()} />);
    await screen.findByRole('table', { name: 'Accounts' });
    expect(container.querySelector('[data-legacy]')).toBeNull();
    expect(container.querySelector('.admin-table, .console-table-wrap')).toBeNull();
  });
});
