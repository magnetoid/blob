// @vitest-environment happy-dom
/** Inviting a guest: by address, into channels the inviter chose (ADR 0034). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const createInvite = vi.fn(async () => ({
  url: 'https://chat.example.com/join/abc',
  expiresAt: '2026-10-28T00:00:00Z',
  emailed: true,
}));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, createInvite },
      admin: { ...actual.api.admin, invites: vi.fn(async () => ({ invites: [] })) },
    },
  };
});

const { InvitationsSection } = await import('./InvitationsSection.tsx');
const { useStore } = await import('../../../lib/store.ts');

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
    fireEvent.change(screen.getByLabelText('Joins as'), { target: { value: 'guest' } });

    const offered = [...document.querySelectorAll('.guest-channel span')].map((n) => n.textContent);
    // Not #board: private, and this admin is not in it. Not a DM.
    expect(offered).toEqual(['#design · private', '#project']);

    const create = screen.getByText('Create invitation').closest('button') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByText('#project'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'g@example.com' } });
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
    fireEvent.click(screen.getByText('Create invitation'));
    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite).toHaveBeenCalledWith({
      email: undefined,
      role: 'member',
      channelIds: undefined,
    });
  });
});
