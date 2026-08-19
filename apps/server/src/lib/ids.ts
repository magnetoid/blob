/**
 * Identifiers.
 *
 * Every primary key is a UUIDv7: time-ordered, so `ORDER BY id` is chronological and
 * "is there anything newer than what I've read?" is a string comparison rather than a
 * timestamp join. This is the one schema decision that cannot be retrofitted cheaply.
 */

import { randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

export function newId(): string {
  return uuidv7();
}

/** UUIDv7s compare chronologically as strings, which is why unread math is cheap. */
export function isNewer(a: string, b: string | null): boolean {
  if (!b) return true;
  return a > b;
}

/** URL-safe opaque token for sessions, invites, resets and webhooks. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
