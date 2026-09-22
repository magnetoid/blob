// @vitest-environment happy-dom
/**
 * An empty Later list arrives when the app opened onto it, and one a tab was switched to
 * does not.
 *
 * The tabs do not change the route, so the first view used to last until somebody went
 * somewhere else — and every tab that went from a list to nothing mounted a new empty
 * state and played the entrance again. Pressing the tab is the move (`lib/firstView`),
 * which is what this holds onto: the pointer going down, as a person's would, before the
 * click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const list = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, later: { ...actual.api.later, list } } };
});

vi.mock('../../lib/socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

const { SavedView } = await import('./SavedView.tsx');
const { useStore } = await import('../../lib/store.ts');

afterEach(cleanup);

const saved = {
  state: 'in_progress',
  remindAt: null,
  remindedAt: null,
  note: null,
  message: {
    id: '01a05000-0000-7000-8000-000000000001',
    channelId: 'c1',
    authorId: 'u1',
    body: 'the plan for Tuesday',
    kind: 'user',
    createdAt: '2026-09-20T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    replyUserIds: [],
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
  },
};

const emptyState = () => document.querySelector<HTMLElement>('.empty-state');

describe('the Later list', () => {
  it('arrives empty on the view the app opened onto, and not on a tab switched to', async () => {
    useStore.setState({
      users: { u1: { id: 'u1', displayName: 'Ana' } },
      channels: { c1: { id: 'c1', kind: 'public', name: 'general' } },
      customEmoji: [],
      currentUser: { id: 'u1' },
    } as never);
    // In progress holds one message and Done holds none, so the switch is from a list to
    // nothing: a new empty state, not the old one retitled.
    list.mockImplementation(async (state: string) => ({
      items: state === 'in_progress' ? [saved] : [],
    }));

    render(<SavedView />);
    await screen.findByText(/the plan for Tuesday/);
    expect(emptyState()).toBeNull();

    const done = screen.getByRole('tab', { name: 'Done' });
    fireEvent.pointerDown(done);
    fireEvent.click(done);
    await screen.findByText('Nothing here');

    expect(list).toHaveBeenLastCalledWith('done');
    // A new empty state, mounted by a tab — asked for, not opened onto.
    expect(emptyState()?.dataset.arriving).toBeUndefined();
  });
});
