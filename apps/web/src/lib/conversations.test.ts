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
import { conversationOrder, stepConversation, stepUnread } from './conversations.ts';

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
