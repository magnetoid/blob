// @vitest-environment happy-dom
/** "Ana is typing…" ends when Ana's message lands, not five seconds after it. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

const { useStore } = await import('./store.ts');

const msg = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    channelId: 'c1',
    authorId: 'ana',
    body: id,
    kind: 'user',
    createdAt: '2026-10-21T10:00:00.000Z',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    ...extra,
  }) as never;

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'me' } as never,
    activeChannelId: 'c1',
    activeThreadRootId: null,
    outbox: {},
    threads: {},
    messages: {},
    channels: {},
    typing: { c1: { ana: Date.now(), bo: Date.now() }, 'c1:root': { ana: Date.now() } },
  });
});

const typing = () => useStore.getState().typing;

describe('a message landing', () => {
  it('ends its author’s typing line in that conversation, and nobody else’s', () => {
    useStore.getState().applyEvent({ t: 'message.new', message: msg('01a') });
    expect(Object.keys(typing().c1 ?? {})).toEqual(['bo']);
    expect(Object.keys(typing()['c1:root'] ?? {})).toEqual(['ana']);
  });

  it('ends it in the thread it was written in', () => {
    useStore.getState().applyEvent({ t: 'message.new', message: msg('01b', { threadRootId: 'root' }) });
    expect(Object.keys(typing()['c1:root'] ?? {})).toEqual([]);
    expect(Object.keys(typing().c1 ?? {})).toEqual(['ana', 'bo']);
  });

  it('is left alone by an edit', () => {
    useStore.getState().applyEvent({ t: 'message.updated', message: msg('01c') });
    expect(Object.keys(typing().c1 ?? {})).toEqual(['ana', 'bo']);
  });
});
