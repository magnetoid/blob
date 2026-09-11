// @vitest-environment happy-dom
/**
 * R3 store batch: insert/ordering, unread string-compare, resync merge.
 *
 * `resync` used to replace the whole channels map from the payload and ignore
 * `readStates`, so a reconnect could forget a channel you were in and drop the
 * read cursor. Edits/deletes/reactions on older ids have to replay too — they
 * do not change id, so treating every sync row as `message.new` missed them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sync = vi.fn();

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      sync,
      channels: { ...actual.api.channels, markRead: vi.fn(async () => ({ readState: {} })) },
    },
  };
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

function seed() {
  const first = msg('m1');
  useStore.setState({
    currentUser: { id: 'me' },
    activeChannelId: null,
    channels: {
      c1: {
        id: 'c1',
        kind: 'public',
        name: 'general',
        lastMessageId: 'm1',
        lastReadMessageId: 'm1',
        mentionCount: 0,
        hasUnread: false,
      },
      c2: {
        id: 'c2',
        kind: 'public',
        name: 'random',
        lastMessageId: 'x1',
        lastReadMessageId: 'x1',
        mentionCount: 0,
        hasUnread: false,
      },
    },
    messages: {
      c1: { items: [first], loaded: true, loading: false, hasMore: false },
      c2: { items: [msg('x1', { channelId: 'c2' })], loaded: true, loading: false, hasMore: false },
    },
    threads: {},
    outbox: {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe('insert/ordering', () => {
  it('keeps the channel sorted by id when a live message arrives out of order', () => {
    useStore.setState({
      channels: {
        c1: { id: 'c1', kind: 'public', name: 'general', lastMessageId: 'm3' },
      },
      messages: {
        c1: { items: [msg('m1'), msg('m3')], loaded: true, loading: false, hasMore: false },
      },
    } as never);

    useStore.getState().applyEvent({ t: 'message.new', message: msg('m2') } as never);

    expect(useStore.getState().messages.c1?.items.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('unread string-compare', () => {
  it('marks unread when a later id arrives in a channel you are not looking at', () => {
    useStore.getState().applyEvent({ t: 'message.new', message: msg('m2') } as never);

    const channel = useStore.getState().channels.c1;
    expect(channel?.hasUnread).toBe(true);
    expect(channel?.lastMessageId).toBe('m2');
    expect('m2' > 'm1').toBe(true);
  });
});

describe('resync merge', () => {
  it('keeps a channel the payload omitted, and applies readStates', async () => {
    sync.mockResolvedValueOnce({
      channels: [
        {
          id: 'c1',
          kind: 'public',
          name: 'general',
          lastMessageId: 'm2',
          lastReadMessageId: 'm1',
          mentionCount: 0,
          hasUnread: true,
        },
      ],
      readStates: [{ channelId: 'c1', lastReadMessageId: 'm2', mentionCount: 0 }],
      messages: [msg('m2')],
      resyncChannelIds: [],
    });

    await useStore.getState().resync();

    const { channels, messages } = useStore.getState();
    expect(channels.c2?.name).toBe('random');
    expect(channels.c1?.lastReadMessageId).toBe('m2');
    expect(messages.c1?.items.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(messages.c2?.items.map((m) => m.id)).toEqual(['x1']);
  });

  it('does not wipe the map when channels comes back empty', async () => {
    sync.mockResolvedValueOnce({
      channels: [],
      readStates: [],
      messages: [],
      resyncChannelIds: [],
    });

    await useStore.getState().resync();

    expect(useStore.getState().channels.c1).toBeTruthy();
    expect(useStore.getState().channels.c2).toBeTruthy();
  });

  it('replays an edit and a delete on messages already on screen', async () => {
    sync.mockResolvedValueOnce({
      channels: [],
      readStates: [],
      messages: [
        msg('m1', { body: 'edited', editedAt: '2026-09-09T11:00:00.000Z' }),
        msg('x1', { channelId: 'c2', deletedAt: '2026-09-09T11:00:00.000Z' }),
      ],
      resyncChannelIds: [],
    });

    await useStore.getState().resync();

    expect(useStore.getState().messages.c1?.items.map((m) => m.body)).toEqual(['edited']);
    expect(useStore.getState().messages.c2?.items.map((m) => m.id)).toEqual([]);
  });

  it('drops a channel whose gap was too large to replay', async () => {
    sync.mockResolvedValueOnce({
      channels: [],
      readStates: [],
      messages: [],
      resyncChannelIds: ['c1'],
    });

    await useStore.getState().resync();

    expect(useStore.getState().messages.c1).toBeUndefined();
    expect(useStore.getState().messages.c2).toBeTruthy();
  });
});
