// @vitest-environment happy-dom
/** A channel frame changes the channel; a membership frame changes your standing in it.
 *
 * These two used to be one frame carrying both, which is why a colleague renaming a
 * channel could move your unread line to wherever they had read to. The store now
 * merges the shared half and applies the personal half separately, and that is exactly
 * what is worth pinning: a `channel.updated` must leave everything of yours alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChannelWithState } from '@blob/shared';

vi.mock('./socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(),
    onStatus: vi.fn(),
    subscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

const { useStore } = await import('./store.ts');

function shared(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c1',
    kind: 'public',
    name: 'general',
    topic: null,
    description: null,
    createdBy: 'u1',
    archivedAt: null,
    lastMessageId: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    workId: null,
    nudgeUnanswered: false,
    ...overrides,
  } as Channel;
}

function mine(overrides: Partial<ChannelWithState> = {}): ChannelWithState {
  return {
    ...shared(),
    membership: { notifyLevel: 'none', isStarred: true, joinedAt: '2026-09-01T00:00:00.000Z' },
    hasUnread: true,
    mentionCount: 3,
    lastReadMessageId: 'm-9',
    ...overrides,
  } as ChannelWithState;
}

beforeEach(() => {
  useStore.setState({ channels: { c1: mine() } });
});

describe('a channel frame', () => {
  it('changes the channel and leaves your own state alone', () => {
    useStore.getState().applyEvent({
      t: 'channel.updated',
      channel: shared({ topic: 'Deploys', nudgeUnanswered: true }),
    });

    const channel = useStore.getState().channels.c1!;
    expect(channel.topic).toBe('Deploys');
    expect(channel.nudgeUnanswered).toBe(true);
    // Yours, untouched — this is the whole point.
    expect(channel.membership?.notifyLevel).toBe('none');
    expect(channel.membership?.isStarred).toBe(true);
    expect(channel.hasUnread).toBe(true);
    expect(channel.mentionCount).toBe(3);
    expect(channel.lastReadMessageId).toBe('m-9');
  });

  it('adds a channel it has never seen as one you are not in', () => {
    useStore.getState().applyEvent({
      t: 'channel.created',
      channel: shared({ id: 'c2', name: 'newsroom' }),
    });

    const channel = useStore.getState().channels.c2!;
    expect(channel.name).toBe('newsroom');
    expect(channel.membership).toBeNull();
    expect(channel.hasUnread).toBe(false);
    expect(channel.mentionCount).toBe(0);
    expect(channel.lastReadMessageId).toBeNull();
  });
});

describe('a membership frame', () => {
  it('changes your standing and leaves the channel alone', () => {
    useStore.getState().applyEvent({
      t: 'channel.membership',
      channelId: 'c1',
      membership: { notifyLevel: 'all', isStarred: false, joinedAt: '2026-09-01T00:00:00.000Z' },
      hasUnread: false,
      mentionCount: 0,
      lastReadMessageId: 'm-12',
    });

    const channel = useStore.getState().channels.c1!;
    expect(channel.membership?.notifyLevel).toBe('all');
    expect(channel.membership?.isStarred).toBe(false);
    expect(channel.hasUnread).toBe(false);
    expect(channel.mentionCount).toBe(0);
    expect(channel.lastReadMessageId).toBe('m-12');
    expect(channel.name).toBe('general');
  });

  it('is ignored for a channel we do not hold', () => {
    useStore.getState().applyEvent({
      t: 'channel.membership',
      channelId: 'nope',
      membership: null,
      hasUnread: false,
      mentionCount: 0,
      lastReadMessageId: null,
    });

    expect(useStore.getState().channels.nope).toBeUndefined();
    expect(Object.keys(useStore.getState().channels)).toEqual(['c1']);
  });

  it('carries a null membership when you are no longer in it', () => {
    useStore.getState().applyEvent({
      t: 'channel.membership',
      channelId: 'c1',
      membership: null,
      hasUnread: false,
      mentionCount: 0,
      lastReadMessageId: null,
    });

    expect(useStore.getState().channels.c1!.membership).toBeNull();
  });
});
