/** Stepping through the sidebar with the keyboard.
 *
 * The order is the thing being tested, not the arithmetic. This function was written
 * twice — once to render the sidebar and once to find the next unread — and the copies
 * had drifted: the keyboard one sorted DMs in among the channels by a name a DM does not
 * have, so ⌘⇧J walked a list nobody could see. Now there is one, and these hold it to
 * what the sidebar draws.
 */

import { describe, expect, it } from 'vitest';
import type { ChannelWithState } from '@blob/shared';
import {
  agentConversations,
  conversationOrder,
  directMessages,
  stepConversation,
  stepUnread,
} from './conversations.ts';

function channel(
  id: string,
  overrides: Partial<ChannelWithState> & { starred?: boolean } = {},
): ChannelWithState {
  const { starred, ...rest } = overrides;
  return {
    id,
    kind: 'public',
    name: id,
    topic: null,
    description: null,
    archivedAt: null,
    hasUnread: false,
    mentionCount: 0,
    lastReadMessageId: null,
    lastMessageId: null,
    memberIds: [],
    membership: { notifyLevel: 'all', isStarred: Boolean(starred) },
    ...rest,
  } as unknown as ChannelWithState;
}

function workspace(...list: ChannelWithState[]): Record<string, ChannelWithState> {
  return Object.fromEntries(list.map((c) => [c.id, c]));
}

describe('the order', () => {
  it('is starred, then alphabetical, then direct messages', () => {
    const channels = workspace(
      channel('zebra'),
      channel('dm-ana', { kind: 'dm', name: null }),
      channel('alpha'),
      channel('starred-last-alphabetically', { starred: true }),
    );

    expect(conversationOrder(channels).map((c) => c.id)).toEqual([
      'starred-last-alphabetically',
      'alpha',
      'zebra',
      'dm-ana',
    ]);
  });

  it('leaves out what the sidebar leaves out', () => {
    const channels = workspace(
      channel('here'),
      channel('archived', { archivedAt: '2026-01-01T00:00:00Z' }),
      channel('not-a-member', { membership: null }),
    );

    expect(conversationOrder(channels).map((c) => c.id)).toEqual(['here']);
  });
});

describe('stepping', () => {
  const channels = workspace(channel('alpha'), channel('beta'), channel('gamma'));

  it('goes down the list', () => {
    expect(stepConversation(channels, 'alpha', 1)).toBe('beta');
  });

  it('and up it', () => {
    expect(stepConversation(channels, 'gamma', -1)).toBe('beta');
  });

  it('wraps at the bottom', () => {
    // A ring, as in Slack. A shortcut that silently does nothing at the last row reads
    // as broken rather than as finished.
    expect(stepConversation(channels, 'gamma', 1)).toBe('alpha');
  });

  it('wraps at the top', () => {
    expect(stepConversation(channels, 'alpha', -1)).toBe('gamma');
  });

  it('starts at the top when nothing is open', () => {
    expect(stepConversation(channels, null, 1)).toBe('alpha');
  });

  it('has nowhere to go in an empty workspace', () => {
    expect(stepConversation({}, null, 1)).toBeNull();
  });

  it('stays put when there is only one conversation', () => {
    const only = workspace(channel('alone'));
    expect(stepConversation(only, 'alone', 1)).toBeNull();
  });
});

describe('stepping to unread', () => {
  it('skips what has been read', () => {
    const channels = workspace(
      channel('alpha'),
      channel('beta'),
      channel('gamma', { hasUnread: true }),
    );

    expect(stepUnread(channels, 'alpha', 1)).toBe('gamma');
  });

  it('is repeatable, reaching the second unread on the second press', () => {
    // Walking from where you are rather than always from the top is the whole point.
    const channels = workspace(
      channel('alpha'),
      channel('beta', { hasUnread: true }),
      channel('gamma', { hasUnread: true }),
    );

    const first = stepUnread(channels, 'alpha', 1);
    expect(first).toBe('beta');
    expect(stepUnread(channels, first, 1)).toBe('gamma');
  });

  it('goes backwards too', () => {
    const channels = workspace(
      channel('alpha', { hasUnread: true }),
      channel('beta'),
      channel('gamma'),
    );

    expect(stepUnread(channels, 'gamma', -1)).toBe('alpha');
  });

  it('wraps backwards past the top', () => {
    const channels = workspace(
      channel('alpha'),
      channel('beta'),
      channel('gamma', { hasUnread: true }),
    );

    expect(stepUnread(channels, 'alpha', -1)).toBe('gamma');
  });

  it('answers nothing when everything has been read', () => {
    expect(stepUnread(workspace(channel('alpha'), channel('beta')), 'alpha', 1)).toBeNull();
  });

  it('does not offer the one you are already looking at', () => {
    const channels = workspace(channel('alpha', { hasUnread: true }), channel('beta'));
    expect(stepUnread(channels, 'alpha', 1)).toBeNull();
  });

  it('finds an unread direct message', () => {
    // The case the old copy got wrong: DMs were sorted by a name they do not have.
    const channels = workspace(
      channel('alpha'),
      channel('dm-ana', { kind: 'dm', name: null, hasUnread: true }),
    );

    expect(stepUnread(channels, 'alpha', 1)).toBe('dm-ana');
  });
});

describe('stepping when nothing in the list is open', () => {
  // Reachable two ways: a reload on /threads or /search leaves activeChannelId null,
  // and a channel being read can be archived out from under the sidebar.
  const channels = workspace(channel('alpha'), channel('beta'), channel('gamma'));

  it('down starts at the top', () => {
    expect(stepConversation(channels, null, 1)).toBe('alpha');
  });

  it('up starts at the bottom', () => {
    // The one that was wrong: the arithmetic read -1 as "second from last", so ⌥↑ from
    // /search landed on beta and gamma could never be reached at all.
    expect(stepConversation(channels, null, -1)).toBe('gamma');
  });

  it('and the same for unread', () => {
    const unread = workspace(
      channel('alpha', { hasUnread: true }),
      channel('beta'),
      channel('gamma', { hasUnread: true }),
    );

    expect(stepUnread(unread, null, 1)).toBe('alpha');
    expect(stepUnread(unread, null, -1)).toBe('gamma');
  });

  it('a channel archived under you is not in the list either', () => {
    const archived = workspace(
      channel('alpha'),
      channel('beta'),
      channel('gone', { archivedAt: '2026-01-01T00:00:00Z' }),
    );

    expect(stepConversation(archived, 'gone', 1)).toBe('alpha');
    expect(stepConversation(archived, 'gone', -1)).toBe('beta');
  });
});

describe('agents are their own section', () => {
  // The Meadow design gives agents a heading of their own between the channels and the
  // direct messages, because "who is in this workspace" reads differently when half of
  // them are programs. The list the keyboard walks has to be the list the sidebar draws
  // — that is the whole reason this module exists — so the split lives here rather than
  // in the sidebar, and `conversationOrder` moves with it.
  const users = {
    me: { id: 'me', kind: 'human', displayName: 'Me' },
    ana: { id: 'ana', kind: 'human', displayName: 'Ana' },
    scout: { id: 'scout', kind: 'bot', displayName: 'Scout' },
  } as unknown as Parameters<typeof conversationOrder>[1];

  const channels = workspace(
    channel('zebra'),
    channel('alpha'),
    channel('dm-ana', { kind: 'dm', name: null, memberIds: ['me', 'ana'] }),
    channel('dm-scout', { kind: 'dm', name: null, memberIds: ['me', 'scout'] }),
  );

  it('puts an agent DM above the people DMs', () => {
    expect(conversationOrder(channels, users).map((c) => c.id)).toEqual([
      'alpha',
      'zebra',
      'dm-scout',
      'dm-ana',
    ]);
  });

  it('sorts a group DM with a bot in it as a person DM, because it has people in it', () => {
    // A DM is an agent's only when the agent is the whole other side of it. A group with
    // Ana, me and Scout is a conversation between people that an agent is also in, and
    // filing it under Agents would hide it from the place its humans look.
    const withGroup = workspace(
      channel('group', {
        kind: 'group_dm',
        name: null,
        memberIds: ['me', 'ana', 'scout'],
      }),
      channel('dm-scout', { kind: 'dm', name: null, memberIds: ['me', 'scout'] }),
    );

    expect(agentConversations(withGroup, users).map((c) => c.id)).toEqual(['dm-scout']);
    expect(directMessages(withGroup, users).map((c) => c.id)).toEqual(['group']);
  });

  it('keeps every conversation in exactly one of the two lists', () => {
    const agents = agentConversations(channels, users).map((c) => c.id);
    const people = directMessages(channels, users).map((c) => c.id);
    expect(agents).toEqual(['dm-scout']);
    expect(people).toEqual(['dm-ana']);
    expect(agents.filter((id) => people.includes(id))).toEqual([]);
  });

  it('falls back to the old single list when it is not told who is a bot', () => {
    // Every caller that has not been given the user map keeps the behaviour it had.
    // Without it a bot is not distinguishable from a person, and guessing from a name
    // would be worse than not splitting at all.
    expect(conversationOrder(channels).map((c) => c.id)).toEqual([
      'alpha',
      'zebra',
      'dm-ana',
      'dm-scout',
    ]);
  });

  it('walks the agents with the keyboard in the order they are drawn', () => {
    expect(stepConversation(channels, 'zebra', 1, users)).toBe('dm-scout');
    expect(stepConversation(channels, 'dm-scout', 1, users)).toBe('dm-ana');
  });

  it('finds an unread agent DM before a later people DM', () => {
    const unread = workspace(
      channel('alpha'),
      channel('dm-ana', { kind: 'dm', name: null, memberIds: ['me', 'ana'], hasUnread: true }),
      channel('dm-scout', {
        kind: 'dm',
        name: null,
        memberIds: ['me', 'scout'],
        hasUnread: true,
      }),
    );

    expect(stepUnread(unread, 'alpha', 1, users)).toBe('dm-scout');
  });
});
