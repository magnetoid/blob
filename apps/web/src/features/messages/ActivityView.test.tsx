// @vitest-environment happy-dom
/** Activity: what each row says it is, and what "New" means.
 *
 * The list is two kinds of thing in one column, and the row's footer is the only place
 * that says which — a reaction that reads like a mention sends you to the wrong place
 * looking for words nobody wrote.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';

const list = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, activity: { list } } };
});

const showMessage = vi.fn(async () => true);
vi.mock('../../lib/navigation.ts', () => ({ showMessage }));

/** happy-dom provides `window` but not `localStorage`; the same shim `changelog.test.ts`
 *  carries. Without it the view still works — that is the storage-unavailable case — but
 *  "New" could never be tested. */
class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}
const storage = new MemoryStorage();
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const { useStore } = await import('../../lib/store.ts');
const { ActivityView } = await import('./ActivityView.tsx');

function message(id: string, body: string): Message {
  return {
    id,
    channelId: 'c1',
    authorId: 'u1',
    kind: 'user',
    body,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    lastReplyAt: null,
    mentionUserIds: [],
    mentionGroupIds: [],
    mentionsEveryone: false,
    clientMsgId: id,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: '2026-09-06T10:00:00.000Z',
    reactions: [],
    attachments: [],
  } as unknown as Message;
}

beforeEach(() => {
  // This project does not auto-clean between tests; without it every render stacks and
  // the queries below find two of everything.
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  useStore.setState({
    users: {
      u1: { id: 'u1', displayName: 'Ana' },
      u2: { id: 'u2', displayName: 'Bo' },
    },
    channels: { c1: { id: 'c1', kind: 'public', name: 'general' } },
    currentUser: { id: 'me', displayName: 'Me' },
    customEmoji: [],
  } as never);
});

describe('the list', () => {
  it('says who mentioned you and who reacted, with the emoji', async () => {
    list.mockResolvedValue({
      items: [
        {
          kind: 'mention',
          at: '2026-09-06T10:00:00.000Z',
          actorId: 'u1',
          emoji: null,
          message: message('m1', 'have a look @Me'),
        },
        {
          kind: 'reaction',
          at: '2026-09-06T09:00:00.000Z',
          actorId: 'u2',
          emoji: '🎉',
          message: message('m2', 'shipped it'),
        },
      ],
      nextCursor: null,
    });

    render(<ActivityView />);
    const mention = await screen.findByText(/mentioned you/);
    expect(mention.textContent).toContain('Ana');
    const reaction = screen.getByText(/reacted to this/);
    expect(reaction.textContent).toContain('Bo');
    expect(screen.getByText('🎉')).toBeTruthy();
  });

  it('marks only what arrived since the last visit', async () => {
    localStorage.setItem('blob.activity.seen', '2026-09-06T09:30:00.000Z');
    list.mockResolvedValue({
      items: [
        {
          kind: 'mention',
          at: '2026-09-06T10:00:00.000Z',
          actorId: 'u1',
          emoji: null,
          message: message('m1', 'newer'),
        },
        {
          kind: 'mention',
          at: '2026-09-06T09:00:00.000Z',
          actorId: 'u1',
          emoji: null,
          message: message('m2', 'older'),
        },
      ],
      nextCursor: null,
    });

    render(<ActivityView />);
    await screen.findByText('newer');
    expect(screen.getAllByText('New')).toHaveLength(1);
    // And the visit is remembered, so next time neither is new.
    await waitFor(() =>
      expect(localStorage.getItem('blob.activity.seen')).toBe('2026-09-06T10:00:00.000Z'),
    );
  });

  it('marks nothing on a first visit', async () => {
    list.mockResolvedValue({
      items: [
        {
          kind: 'mention',
          at: '2026-09-06T10:00:00.000Z',
          actorId: 'u1',
          emoji: null,
          message: message('m1', 'first ever'),
        },
      ],
      nextCursor: null,
    });

    render(<ActivityView />);
    await screen.findByText('first ever');
    expect(screen.queryByText('New')).toBeNull();
  });

  it('narrows to one kind and asks the server for it', async () => {
    list.mockResolvedValue({ items: [], nextCursor: null });
    render(<ActivityView />);
    await waitFor(() => expect(list).toHaveBeenCalledWith('all'));

    fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
    await waitFor(() => expect(list).toHaveBeenCalledWith('reaction'));
  });

  it('says so when there is nothing rather than looking broken', async () => {
    list.mockResolvedValue({ items: [], nextCursor: null });
    render(<ActivityView />);
    expect(await screen.findByText('Nothing yet')).toBeTruthy();
  });

  it('keeps what is on screen when the next page fails', async () => {
    list.mockResolvedValueOnce({
      items: [
        {
          kind: 'mention',
          at: '2026-09-06T10:00:00.000Z',
          actorId: 'u1',
          emoji: null,
          message: message('m1', 'still here'),
        },
      ],
      nextCursor: 'cursor-1',
    });
    list.mockRejectedValueOnce(new Error('nope'));

    render(<ActivityView />);
    await screen.findByText('still here');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.getByText('still here')).toBeTruthy();
  });
});
