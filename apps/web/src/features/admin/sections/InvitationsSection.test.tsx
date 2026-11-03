// @vitest-environment happy-dom
/** Inviting a guest: by address, into channels the inviter chose (ADR 0034). And the link
 * an invitation makes, which is shown once in a field of its own that a person can read
 * whole and copy — the end-to-end run reads it from there by its name. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { createInvite, invites, revokeInvite } = vi.hoisted(() => ({
  createInvite: vi.fn(),
  invites: vi.fn(),
  revokeInvite: vi.fn(async () => ({})),
}));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, createInvite },
      admin: { ...actual.api.admin, invites, revokeInvite },
    },
  };
});

const { InvitationsSection } = await import('./InvitationsSection.tsx');
const { useStore } = await import('../../../lib/store.ts');

beforeEach(() => {
  createInvite.mockImplementation(async () => ({
    url: 'https://chat.example.com/join/abc',
    expiresAt: '2026-10-28T00:00:00Z',
    emailed: true,
  }));
  invites.mockImplementation(async () => ({ invites: [] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function seedChannels() {
  useStore.setState({
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'project', membership: {}, archivedAt: null },
      c2: { id: 'c2', kind: 'private', name: 'board', membership: null, archivedAt: null },
      c3: { id: 'c3', kind: 'private', name: 'design', membership: {}, archivedAt: null },
      c4: { id: 'c4', kind: 'dm', name: null, membership: {}, archivedAt: null },
    },
  } as never);
}

describe('inviting a guest', () => {
  it('offers the channels this admin can see, and sends the ones chosen', async () => {
    seedChannels();
    render(<InvitationsSection onError={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Joins as' }), { target: { value: 'guest' } });

    const group = screen.getByRole('group', { name: 'Channels the guest may see' });
    const boxes = within(group).getAllByRole('checkbox');
    // Not #board: private, and this admin is not in it. Not a DM.
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBe(within(group).getByRole('checkbox', { name: '#design · private' }));
    expect(boxes[1]).toBe(within(group).getByRole('checkbox', { name: '#project' }));
    // What the choice means, said to whoever reaches the group.
    expect(
      screen.getByRole('group', {
        name: 'Channels the guest may see',
        description: /A guest sees these channels and the people in them/,
      }),
    ).toBeTruthy();

    const create = screen.getByRole('button', { name: 'Create invitation' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '#project' }));
    expect(screen.getByRole('checkbox', { name: '#project', checked: true })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'g@example.com' } });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);

    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite).toHaveBeenCalledWith({
      email: 'g@example.com',
      role: 'guest',
      channelIds: ['c1'],
    });
  });

  it('sends no channels for anybody else', async () => {
    seedChannels();
    render(<InvitationsSection onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite).toHaveBeenCalledWith({
      email: undefined,
      role: 'member',
      channelIds: undefined,
    });
  });

  it('asks for an address only of a guest, and offers an admin role only to the owner', () => {
    seedChannels();
    const { unmount } = render(<InvitationsSection onError={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Email (optional)' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'admin' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Joins as' }), { target: { value: 'guest' } });
    expect((screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).required).toBe(true);
    unmount();

    render(<InvitationsSection onError={vi.fn()} isOwner />);
    expect(screen.getByRole('option', { name: 'admin' })).toBeTruthy();
  });
});

describe('the link an invitation makes', () => {
  it('is shown whole in a field named for it, which holds exactly the link', async () => {
    render(<InvitationsSection onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    const field = (await screen.findByRole('textbox', { name: 'Invitation link' })) as HTMLInputElement;
    expect(field.value).toBe('https://chat.example.com/join/abc');
    expect(field.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText(/Emailed\. The link is here too/)).toBeTruthy();
  });

  it('says when the email did not go out, because the link is then the only copy', async () => {
    createInvite.mockImplementation(async () => ({
      url: 'https://chat.example.com/join/xyz',
      expiresAt: '',
      emailed: false,
    }));
    render(<InvitationsSection onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The email did not go out');
    expect(screen.getByRole('textbox', { name: 'Invitation link' })).toBeTruthy();
  });
});

describe('who has been invited', () => {
  const INVITES = [
    {
      id: 'i1',
      email: 'new@example.com',
      role: 'member',
      status: 'pending',
      createdByName: 'Olga',
      acceptedByName: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'i2',
      email: null,
      role: 'admin',
      status: 'pending',
      createdByName: null,
      acceptedByName: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'i3',
      email: 'old@example.com',
      role: 'member',
      status: 'accepted',
      createdByName: 'Olga',
      acceptedByName: 'Max',
      createdAt: new Date().toISOString(),
    },
  ];

  it('is a list, with Revoke only on what is still pending, naming what it revokes', async () => {
    invites.mockImplementation(async () => ({ invites: INVITES }));
    render(<InvitationsSection onError={vi.fn()} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText('new@example.com')).toBeTruthy();
    expect(within(rows[0]!).getByRole('button', { name: 'Revoke the invitation to new@example.com' })).toBeTruthy();
    // A link nobody was named for is still a thing to name.
    expect(within(rows[1]!).getByText('Shareable link')).toBeTruthy();
    expect(within(rows[1]!).getByText('admin')).toBeTruthy();
    expect(
      within(rows[1]!).getByRole('button', { name: 'Revoke the invitation to a shareable link' }),
    ).toBeTruthy();
    expect(within(rows[2]!).getByText('accepted')).toBeTruthy();
    expect(within(rows[2]!).getByText(/accepted by Max/)).toBeTruthy();
    expect(within(rows[2]!).queryByRole('button')).toBeNull();
  });

  it('revokes the one asked, and asks the server again', async () => {
    invites.mockImplementation(async () => ({ invites: INVITES }));
    render(<InvitationsSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke the invitation to new@example.com' }));
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('i1'));
    await waitFor(() => expect(invites.mock.calls.length).toBeGreaterThan(1));
  });

  it('says so when there are none', async () => {
    render(<InvitationsSection onError={vi.fn()} />);
    expect(await screen.findByText('No invitations yet.')).toBeTruthy();
  });
});
