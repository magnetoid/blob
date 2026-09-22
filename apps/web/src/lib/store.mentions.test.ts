// @vitest-environment happy-dom
/**
 * Whom you tagged last, kept current between boots.
 *
 * Boot brings the list the server read off your last messages; after that, the only tags
 * it cannot know about are the ones you make in this session. Without these a picker
 * that put the person you tagged a minute ago first would need a reload to notice.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

let sequence = 0;

/** A new message, newer than the one before it. */
function message(authorId: string, users: string[], groups: string[] = [], overrides = {}) {
  sequence += 1;
  return {
    id: `m${String(sequence).padStart(4, '0')}`,
    channelId: 'c1',
    authorId,
    body: 'hello',
    kind: 'user',
    createdAt: '2026-09-22T10:00:00.000Z',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: users,
    mentionGroupIds: groups,
    mentionsEveryone: false,
    deletedAt: null,
    editedAt: null,
    ...overrides,
  };
}

const arrive = (m: ReturnType<typeof message>, t: 'message.new' | 'message.updated' = 'message.new') =>
  useStore.getState().applyEvent({ t, message: m } as never);

const people = () => useStore.getState().recentMentionUserIds;
const groups = () => useStore.getState().recentMentionGroupIds;

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'me' },
    activeChannelId: null,
    channels: { c1: { id: 'c1', kind: 'public', name: 'general', lastMessageId: null } },
    messages: {},
    threads: {},
    outbox: {},
    recentMentionUserIds: ['ana', 'bruno'],
    recentMentionGroupIds: ['design'],
    recentMentionsAsOf: null,
  } as never);
});

/** A channel whose loaded page holds these messages, as it would once opened. */
function loaded(...items: ReturnType<typeof message>[]) {
  useStore.setState({
    messages: { c1: { items, hasMore: false, loading: false, loaded: true } },
  } as never);
}

const remove = (m: ReturnType<typeof message>) =>
  useStore.getState().applyEvent({
    t: 'message.deleted',
    id: m.id,
    channelId: m.channelId,
    threadRootId: m.threadRootId,
  } as never);

describe('boot', () => {
  it('starts from the list the server read', () => {
    useStore.getState().boot({
      workspace: { id: 'w1', name: 'W' },
      user: { id: 'me' },
      users: [],
      channels: [],
      customEmoji: [],
      commands: [],
      themes: [],
      savedMessageIds: [],
      groups: [],
      myGroupIds: [],
      mutedGroupIds: [],
      serverCommit: null,
      translationEnabled: false,
      recentMentionUserIds: ['cleo', 'ana'],
      recentMentionGroupIds: ['platform'],
    } as never);

    expect(people()).toEqual(['cleo', 'ana']);
    expect(groups()).toEqual(['platform']);
  });

  it('forgets it on sign-out', () => {
    useStore.getState().reset();
    expect(people()).toEqual([]);
    expect(groups()).toEqual([]);
  });
});

describe('a message of your own', () => {
  it('puts whom it tagged first, without a reload', () => {
    arrive(message('me', ['cleo']));
    expect(people()).toEqual(['cleo', 'ana', 'bruno']);
  });

  it('moves somebody already listed rather than listing them twice', () => {
    arrive(message('me', ['bruno']));
    expect(people()).toEqual(['bruno', 'ana']);
  });

  it('keeps several names in the order they were written', () => {
    // The server's rule for one message, so a reload does not reshuffle them.
    arrive(message('me', ['cleo', 'bruno']));
    expect(people()).toEqual(['cleo', 'bruno', 'ana']);
  });

  it('does the same for groups', () => {
    arrive(message('me', [], ['platform']));
    expect(groups()).toEqual(['platform', 'design']);
    expect(people()).toEqual(['ana', 'bruno']);
  });

  it('never lists you', () => {
    arrive(message('me', ['me', 'cleo']));
    expect(people()).toEqual(['cleo', 'ana', 'bruno']);
  });

  it('stops at thirty', () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}`);
    arrive(message('me', many));
    expect(people()).toEqual(many.slice(0, 30));
  });

  it('changes nothing the second time it arrives', () => {
    // Every send lands twice: once as the request's answer and once as its own socket
    // frame. The second is a no-op down to the array, or every composer re-renders.
    const sent = message('me', ['cleo']);
    arrive(sent);
    const after = people();
    arrive(sent);
    expect(people()).toBe(after);
  });

  it('counts a reply in a thread too', () => {
    arrive(message('me', ['cleo'], [], { threadRootId: 'root' }));
    expect(people()[0]).toBe('cleo');
  });

  it('is not moved by an edit', () => {
    // The server ranks by when a message was written. Re-ranking on an edit here would
    // be undone by the next reload, and a list that reorders itself is worse than one
    // that is a moment behind.
    const sent = message('me', ['ana']);
    arrive(sent);
    arrive({ ...sent, mentionUserIds: ['cleo'] }, 'message.updated');
    expect(people()).toEqual(['ana', 'bruno']);
  });

  it('counts for nothing when you did not type it', () => {
    // An incoming webhook posts as the admin who created it, with kind "bot" — the
    // server leaves those out, so the live list has to as well.
    const before = people();
    arrive(message('me', ['cleo'], ['platform'], { kind: 'bot' }));
    expect(people()).toBe(before);
    expect(groups()).toEqual(['design']);
  });

  it('does not overtake a newer one when it is answered late', () => {
    // Two sends in flight: the second's answer lands first. The first must not then jump
    // ahead of it — the same rule the channel's tail pointer keeps.
    const earlier = message('me', ['dara']);
    const later = message('me', ['cleo']);
    arrive(later);
    arrive(earlier);
    expect(people()).toEqual(['cleo', 'ana', 'bruno']);
  });

  it('is not held back by a newer message that tagged nobody', () => {
    // Only a message that moved the list counts as the newest one counted: a plain
    // "thanks" sent after it says nothing about whom you tag.
    const earlier = message('me', ['dara']);
    const later = message('me', []);
    arrive(later);
    arrive(earlier);
    expect(people()[0]).toBe('dara');
  });
});

describe('a message of yours deleted', () => {
  it('takes back whom it tagged', () => {
    // What the server would say at the next boot: a deleted message tags nobody.
    const oops = message('me', ['cleo'], ['platform']);
    arrive(oops);
    loaded(oops);

    remove(oops);

    expect(people()).toEqual(['ana', 'bruno']);
    expect(groups()).toEqual(['design']);
  });

  it('leaves the list alone when it tagged nobody, or was somebody else’s', () => {
    const plain = message('me', []);
    const theirs = message('them', ['ana']);
    loaded(plain, theirs);
    const before = people();

    remove(plain);
    remove(theirs);

    expect(people()).toBe(before);
  });
});

describe('somebody else', () => {
  it('tagging people says nothing about whom you tag', () => {
    const before = people();
    arrive(message('them', ['cleo']));
    expect(people()).toBe(before);
  });
});
