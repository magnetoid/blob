// @vitest-environment happy-dom
/** Starting a conversation, which the client could barely do.
 *
 * Two paths existed and both sent exactly one user id: the sidebar row and ⌘K. There was
 * no "New message" control at all, and a group message could only be made by typing
 * `/dm @ana @bob` — the server has always accepted several ids, and nothing in the
 * interface ever sent them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const openDm = vi.fn();
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { dms: { open: (...args: unknown[]) => openDm(...args) } } };
});
vi.mock('../../lib/navigation.ts', () => ({ showChannel: vi.fn() }));

const { NewMessageDialog, MAX_DM_MEMBERS } = await import('./NewMessageDialog.tsx');
const { useStore } = await import('../../lib/store.ts');

function person(id: string, displayName: string) {
  return { id, displayName, avatarUrl: null, deactivated: false, title: null };
}

beforeEach(() => {
  openDm.mockReset();
  openDm.mockResolvedValue({ channel: { id: 'dm1', kind: 'dm' } });
  const people = ['Ana', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn', 'Gus', 'Hana', 'Ivan'];
  useStore.setState({
    currentUser: person('me', 'Me'),
    users: Object.fromEntries(
      people.map((name, i) => [`u${i}`, person(`u${i}`, name)]),
    ),
    channels: {},
  } as never);
});

afterEach(cleanup);

const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));

describe('the new message dialog', () => {
  it('opens a conversation with one person', async () => {
    render(<NewMessageDialog onClose={vi.fn()} />);
    pick('Ana');

    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    await vi.waitFor(() => expect(openDm).toHaveBeenCalledWith(['u0']));
  });

  it('opens one with several, which nothing in the client could do before', async () => {
    render(<NewMessageDialog onClose={vi.fn()} />);
    pick('Ana');
    pick('Bob');

    fireEvent.click(screen.getByRole('button', { name: 'Start group message' }));
    await vi.waitFor(() => expect(openDm).toHaveBeenCalledWith(['u0', 'u1']));
  });

  it('says where the cap is instead of letting the server refuse it', () => {
    render(<NewMessageDialog onClose={vi.fn()} />);
    for (const name of ['Ana', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn', 'Gus']) pick(name);

    // Seven others plus you is the eight the server allows.
    expect(screen.getByText(new RegExp(`holds ${MAX_DM_MEMBERS} people`))).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Hana/ }).disabled).toBe(true);
  });

  it('takes a name back off the list', () => {
    render(<NewMessageDialog onClose={vi.fn()} />);
    pick('Ana');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ana' }));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Message' }).disabled).toBe(
      true,
    );
  });

  it('narrows the list as you type', () => {
    render(<NewMessageDialog onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'ca' } });

    expect(screen.getByRole('button', { name: /Cara/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bob/ })).toBeNull();
  });
});
