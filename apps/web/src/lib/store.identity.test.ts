// @vitest-environment happy-dom
/**
 * Reference identity across the store's hot paths.
 *
 * A channel nobody touched keeps the same `items` array when something happens
 * somewhere else — a reaction in another channel, a message queued for another
 * channel. That identity is what stops every open list from re-rendering on every
 * event, and it is the property the linear merge, the binary-search upsert and the
 * diffed outbox projection exist to keep.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: { ...actual.api } };
});

vi.mock('./socket.ts', () => ({
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

const { useStore } = await import('./store.ts');

function msg(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    channelId: 'c1',
    authorId: 'them',
    body: id,
    kind: 'user',
    createdAt: '2026-09-09T10:00:00.000Z',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    deletedAt: null,
    editedAt: null,
    ...overrides,
  };
}

function list(items: unknown[]) {
  return { items, loaded: true, loading: false, hasMore: false };
}

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'me' },
    activeChannelId: null,
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', lastMessageId: 'm2' },
      c2: { id: 'c2', kind: 'public', name: 'random', lastMessageId: 'x2' },
    },
    messages: {
      c1: list([msg('m1'), msg('m2')]),
      c2: list([msg('x1', { channelId: 'c2' }), msg('x2', { channelId: 'c2' })]),
    },
    threads: {
      m1: [msg('m1'), msg('r1', { threadRootId: 'm1' })],
      x1: [msg('x1', { channelId: 'c2' }), msg('q1', { channelId: 'c2', threadRootId: 'x1' })],
    },
    outbox: {
      queued: {
        clientMsgId: 'queued',
        channelId: 'c2',
        threadRootId: null,
        body: 'later',
        attachmentIds: [],
        alsoInChannel: false,
        createdAt: '2026-09-09T10:00:01.000Z',
        status: 'queued',
        attempts: 0,
        lastError: null,
      },
    },
  } as never);
});

describe('a reaction elsewhere', () => {
  it('leaves the other channel and the other threads untouched', () => {
    const before = useStore.getState();
    useStore.getState().applyEvent({
      t: 'reaction.added',
      messageId: 'q1',
      channelId: 'c2',
      threadRootId: 'x1',
      emoji: '👍',
      userId: 'them',
    } as never);
    const after = useStore.getState();

    expect(after.messages.c1).toBe(before.messages.c1);
    expect(after.messages.c1?.items).toBe(before.messages.c1?.items);
    expect(after.threads.m1).toBe(before.threads.m1);
    // The reply is in its thread, not in the channel list, so the channel list is
    // untouched too — mapping it found nothing to change.
    expect(after.messages.c2?.items).toBe(before.messages.c2?.items);
    expect(after.threads.x1?.[1]?.reactions).toEqual([{ emoji: '👍', userIds: ['them'] }]);
  });

  it('reaches a root in its own thread list as well as in the channel', () => {
    useStore.getState().applyEvent({
      t: 'reaction.added',
      messageId: 'm1',
      channelId: 'c1',
      threadRootId: null,
      emoji: '👀',
      userId: 'them',
    } as never);
    const after = useStore.getState();
    expect(after.messages.c1?.items[0]?.reactions).toHaveLength(1);
    expect(after.threads.m1?.[0]?.reactions).toHaveLength(1);
    expect(after.threads.x1).toBe(useStore.getState().threads.x1);
  });
});

describe('an outbox change elsewhere', () => {
  it('re-overlays only the channel whose entry changed', () => {
    const before = useStore.getState();
    useStore.getState().discardQueuedMessage('queued');
    const after = useStore.getState();

    expect(after.outbox.queued).toBeUndefined();
    expect(after.messages.c1?.items).toBe(before.messages.c1?.items);
    expect(after.threads.m1).toBe(before.threads.m1);
    expect(after.threads.x1).toBe(before.threads.x1);
    expect(after.messages.c2?.items).not.toBe(before.messages.c2?.items);
  });
});

describe('ordering still holds', () => {
  it('inserts live messages at their sorted place, out of order or at the tail', () => {
    useStore.setState({
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', lastMessageId: 'm3' } },
      messages: { c1: list([msg('m1'), msg('m3')]) },
    } as never);
    useStore.getState().applyEvent({ t: 'message.new', message: msg('m2') } as never);
    useStore.getState().applyEvent({ t: 'message.new', message: msg('m4') } as never);
    expect(useStore.getState().messages.c1?.items.map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });
});
