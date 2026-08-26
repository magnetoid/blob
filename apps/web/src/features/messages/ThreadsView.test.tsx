// @vitest-environment happy-dom
/** The Threads view.
 *
 * `threads_for_user` has answered this since the port and its docstring calls it "the
 * sidebar's Threads view" — there was no such view, and `api.messages.threads()` was
 * called by nothing.
 *
 * The one subtle thing worth pinning is the order on the way out. The thread panel
 * renders beside the conversation, so the channel has to be open before the thread is,
 * or the panel appears next to whatever channel happened to be active.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';

const threads = vi.fn(async () => ({ messages: [] as Message[] }));
const calls: string[] = [];
const openChannel = vi.fn(async (id: string) => {
  calls.push(`channel:${id}`);
});
const openThread = vi.fn(async (id: string) => {
  calls.push(`thread:${id}`);
});
const navigate = vi.fn((path: string) => calls.push(`navigate:${path}`));

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { messages: { threads: () => threads() } } };
});

vi.mock('../../lib/router.ts', () => ({
  navigate: (p: string) => navigate(p),
  pathForChannel: (channelId: string, threadRootId?: string) =>
    threadRootId ? `/c/${channelId}/t/${threadRootId}` : `/c/${channelId}`,
}));

const storeState = {
  users: { u1: { id: 'u1', displayName: 'Ana', avatarUrl: null } },
  channels: { c1: { id: 'c1', name: 'eng', kind: 'public' } },
  activeChannelId: null,
  openChannel,
  openThread,
  channelTitle: () => 'eng',
};

vi.mock('../../lib/store.ts', () => {
  const useStore = (select: (state: unknown) => unknown) => select(storeState);
  // `showThread` goes through the store imperatively, the way navigation.ts does.
  useStore.getState = () => storeState;
  return { useStore };
});

const { ThreadsView } = await import('./ThreadsView.tsx');

function thread(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    channelId: 'c1',
    authorId: 'u1',
    body: 'Should we ship on Friday?',
    replyCount: 3,
    lastReplyAt: new Date(Date.now() - 60_000).toISOString(),
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    reactions: [],
    attachments: [],
    ...overrides,
  } as Message;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});
afterEach(cleanup);

describe('the threads list', () => {
  it('says so plainly when there are none', async () => {
    render(<ThreadsView />);
    expect(await screen.findByText('No threads yet')).toBeTruthy();
  });

  it('shows the channel, the reply count and when it last moved', async () => {
    threads.mockResolvedValueOnce({ messages: [thread()] });
    render(<ThreadsView />);

    expect(await screen.findByText('Should we ship on Friday?')).toBeTruthy();
    expect(screen.getByText('3 replies')).toBeTruthy();
    expect(screen.getByText(/#eng/)).toBeTruthy();
  });

  it('counts one reply in the singular', async () => {
    threads.mockResolvedValueOnce({ messages: [thread({ replyCount: 1 })] });
    render(<ThreadsView />);
    expect(await screen.findByText('1 reply')).toBeTruthy();
  });

  it('opens the channel before the thread, then goes there', async () => {
    threads.mockResolvedValueOnce({ messages: [thread()] });
    render(<ThreadsView />);
    fireEvent.click(await screen.findByText('Should we ship on Friday?'));

    // The panel renders beside the conversation. Opening the thread first would put it
    // next to whichever channel was already active.
    await waitFor(() =>
      expect(calls).toEqual(['channel:c1', 'thread:m1', 'navigate:/c/c1/t/m1']),
    );
  });

  it('says so rather than showing an empty list when the request fails', async () => {
    threads.mockRejectedValueOnce(new Error('offline'));
    render(<ThreadsView />);

    expect(await screen.findByText('Those could not be loaded.')).toBeTruthy();
    // "No threads yet" would be a lie about the same screen.
    expect(screen.queryByText('No threads yet')).toBeNull();
  });
});
