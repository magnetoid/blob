/** The order the sidebar draws conversations in, as a function.
 *
 * It was written twice — once in `Sidebar` to render and once in `Workspace` to find the
 * next unread — and the two had already drifted: the second sorted DMs in among the
 * channels by a name they do not have, so ⌘⇧J walked a list nobody could see. A keyboard
 * shortcut that moves through a list has to move through *the* list, or pressing it feels
 * like the app guessing.
 *
 * Starred first, then by name, then the agents, then the direct messages. That is what
 * the sidebar shows, and this is now the only place it is decided.
 *
 * Agents sit between the two because the design gives them a heading of their own, and
 * because the same drift is available here as the one above: a sidebar that draws three
 * sections while the keyboard walks two would send ⌘⇧J somewhere the eye cannot follow.
 */

import type { ChannelWithState, User } from '@blob/shared';

/** Who is a person and who is a program, when the caller knows. */
type UserDirectory = Record<string, User | undefined>;

function byName(a: ChannelWithState, b: ChannelWithState): number {
  return (a.name ?? '').localeCompare(b.name ?? '');
}

/**
 * Whether this conversation is one person alone with one agent.
 *
 * A one-to-one DM with a bot, and nothing else. A *group* DM that happens to contain an
 * agent stays a conversation between people — filing it under Agents would hide it from
 * the section its humans look in, which is the opposite of what the heading is for.
 *
 * `users` is optional throughout this module on purpose. Without it a bot cannot be told
 * from a person, and the honest answer is to keep the single list every caller had
 * before rather than guess from a display name.
 */
function isAgentDm(channel: ChannelWithState, users: UserDirectory): boolean {
  // `some` rather than "every member except me", which would need to be told who you
  // are. A one-to-one DM has exactly two sides and you are never the bot, so a bot
  // anywhere in a `dm` is the other side of it — and `group_dm` is already excluded.
  if (channel.kind !== 'dm') return false;
  return (channel.memberIds ?? []).some((id) => users[id]?.kind === 'bot');
}

/** The channels this person is in, starred first — the sidebar's upper section. */
export function joinedChannels(
  channels: Record<string, ChannelWithState>,
): ChannelWithState[] {
  return Object.values(channels)
    .filter(
      (c) =>
        c.membership !== null &&
        !c.archivedAt &&
        (c.kind === 'public' || c.kind === 'private'),
    )
    .sort((a, b) => {
      const starred = Number(b.membership?.isStarred) - Number(a.membership?.isStarred);
      return starred !== 0 ? starred : byName(a, b);
    });
}

function openDms(channels: Record<string, ChannelWithState>): ChannelWithState[] {
  return Object.values(channels).filter(
    (c) => c.membership !== null && !c.archivedAt && (c.kind === 'dm' || c.kind === 'group_dm'),
  );
}

/** The one-to-one conversations with agents — the sidebar's Agents section. */
export function agentConversations(
  channels: Record<string, ChannelWithState>,
  users: UserDirectory = {},
): ChannelWithState[] {
  return openDms(channels).filter((c) => isAgentDm(c, users));
}

/** The direct messages with people, in the order they arrived. */
export function directMessages(
  channels: Record<string, ChannelWithState>,
  users: UserDirectory = {},
): ChannelWithState[] {
  return openDms(channels).filter((c) => !isAgentDm(c, users));
}

/** Everything you can step through with the keyboard, top to bottom as drawn. */
export function conversationOrder(
  channels: Record<string, ChannelWithState>,
  users: UserDirectory = {},
): ChannelWithState[] {
  return [
    ...joinedChannels(channels),
    ...agentConversations(channels, users),
    ...directMessages(channels, users),
  ];
}

/**
 * The conversation `step` places from the current one, wrapping at both ends.
 *
 * Wrapping rather than stopping: the list is a ring in Slack too, and a shortcut that
 * silently does nothing at the last row reads as broken rather than as finished.
 * `null` when there is nowhere to go — an empty workspace, or a list of one.
 */
export function stepConversation(
  channels: Record<string, ChannelWithState>,
  activeChannelId: string | null,
  step: 1 | -1,
  users: UserDirectory = {},
): string | null {
  const ordered = conversationOrder(channels, users);
  if (ordered.length === 0) return null;

  const from = ordered.findIndex((c) => c.id === activeChannelId);
  if (from === -1) {
    // Nothing in the list is open — a reload on /threads or /search, or the channel
    // being read has just been archived out from under the sidebar. Down starts at the
    // top and up starts at the bottom. Falling through to the arithmetic below made -1
    // mean "the second from last", which skipped the bottom row and could never reach it.
    const edge = step === 1 ? ordered[0] : ordered[ordered.length - 1];
    return edge ? edge.id : null;
  }
  const next = ordered[(from + step + ordered.length) % ordered.length];
  return next && next.id !== activeChannelId ? next.id : null;
}

/**
 * The next conversation with something unread, `step` in that direction.
 *
 * Walks from where you are rather than always from the top, which is what makes it
 * repeatable: pressing it twice should reach the second unread, not the first again.
 */
export function stepUnread(
  channels: Record<string, ChannelWithState>,
  activeChannelId: string | null,
  step: 1 | -1,
  users: UserDirectory = {},
): string | null {
  const ordered = conversationOrder(channels, users);
  if (ordered.length === 0) return null;

  // -1 when nothing in the list is open. Walking from there is walking from just before
  // the top going down, or just after the bottom going up, which is what the offsets do.
  const from = ordered.findIndex((c) => c.id === activeChannelId);
  const start = from === -1 ? (step === 1 ? -1 : ordered.length) : from;
  for (let moved = 1; moved <= ordered.length; moved += 1) {
    const index =
      (start + step * moved + ordered.length * ordered.length) % ordered.length;
    const candidate = ordered[index];
    if (candidate && candidate.hasUnread && candidate.id !== activeChannelId) {
      return candidate.id;
    }
  }
  return null;
}
