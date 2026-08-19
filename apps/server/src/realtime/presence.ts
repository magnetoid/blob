/**
 * Presence and typing.
 *
 * Both live only in Redis with a TTL — losing them costs one heartbeat of accuracy
 * and nothing else. Presence updates are pushed only to connections that explicitly
 * subscribed to that user, which is the change that cut Slack's presence traffic 5×.
 */

import type { PresenceState } from '@blob/shared';
import { TYPING_TTL_MS } from '@blob/shared';
import { presenceKey, redis, typingKey } from '../lib/redis.ts';
import * as hub from './hub.ts';

/** Presence keys expire after two missed heartbeats. */
const PRESENCE_TTL_SEC = 60;

export async function markActive(userId: string): Promise<void> {
  const previous = await redis.get(presenceKey(userId));
  await redis.set(presenceKey(userId), 'active', 'EX', PRESENCE_TTL_SEC);
  if (previous !== 'active') announce(userId, 'active');
}

export async function markAway(userId: string): Promise<void> {
  const previous = await redis.get(presenceKey(userId));
  await redis.set(presenceKey(userId), 'away', 'EX', PRESENCE_TTL_SEC);
  if (previous !== 'away') announce(userId, 'away');
}

/** Called when a user's last connection drops. */
export async function markOffline(userId: string): Promise<void> {
  if (hub.isUserOnline(userId)) return;
  await redis.del(presenceKey(userId));
  announce(userId, 'offline');
}

export async function getPresence(userIds: string[]): Promise<Record<string, PresenceState>> {
  if (userIds.length === 0) return {};
  const values = await redis.mget(userIds.map(presenceKey));
  const result: Record<string, PresenceState> = {};
  userIds.forEach((id, i) => {
    const value = values[i];
    result[id] = value === 'active' || value === 'away' ? value : 'offline';
  });
  return result;
}

export async function setTyping(
  channelId: string,
  userId: string,
  threadRootId: string | null,
): Promise<void> {
  await redis.set(typingKey(channelId, userId), threadRootId ?? '', 'PX', TYPING_TTL_MS);
  hub.toChannel(channelId, { t: 'typing', channelId, userId, threadRootId });
}

function announce(userId: string, state: PresenceState): void {
  hub.toPresenceSubscribers(userId, { t: 'presence', userId, state });
}
