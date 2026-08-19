/** Fixed-window rate limiting in Redis. Simple, adequate, and cheap at this scale. */

import { redis, rateKey } from './redis.ts';
import { tooManyRequests } from './errors.ts';

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

export const LIMITS = {
  login: { max: 10, windowSec: 900 },
  signup: { max: 5, windowSec: 3600 },
  passwordReset: { max: 5, windowSec: 3600 },
  sendMessage: { max: 30, windowSec: 60 },
  upload: { max: 20, windowSec: 60 },
  search: { max: 30, windowSec: 60 },
  webhook: { max: 60, windowSec: 60 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

/** Throws 429 when the subject has exhausted the window. */
export async function consume(name: LimitName, subject: string): Promise<void> {
  const limit = LIMITS[name];
  const key = rateKey(name, subject);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, limit.windowSec);
  if (count > limit.max) {
    const ttl = await redis.ttl(key);
    throw tooManyRequests(
      `Too many attempts. Try again in ${ttl > 0 ? `${ttl}s` : 'a moment'}.`,
    );
  }
}
