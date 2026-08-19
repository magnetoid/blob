/**
 * Redis holds everything ephemeral: presence, typing, rate limits, and the pub/sub
 * bridge that lets a second app container work with no code change.
 *
 * Nothing here is durable. If Redis restarts, presence goes quiet for one heartbeat
 * and nothing else notices.
 */

import { Redis } from 'ioredis';
import { config } from '../config.ts';

const options = { maxRetriesPerRequest: null, lazyConnect: false } as const;

/** Commands. */
export const redis = new Redis(config.REDIS_URL, options);
/** A subscriber connection cannot issue normal commands, so it needs its own socket. */
export const redisSub = new Redis(config.REDIS_URL, options);

for (const [name, client] of [
  ['redis', redis],
  ['redis-sub', redisSub],
] as const) {
  client.on('error', (err) => console.error({ err, client: name }, 'redis error'));
}

/** Channel on which app processes exchange WebSocket events. */
export const EVENTS_CHANNEL = 'ws:events';

export const presenceKey = (userId: string) => `presence:${userId}`;
export const typingKey = (channelId: string, userId: string) => `typing:${channelId}:${userId}`;
export const rateKey = (bucket: string, subject: string) => `rate:${bucket}:${subject}`;

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSub.quit()]);
}
