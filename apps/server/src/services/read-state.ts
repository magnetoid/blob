/**
 * Unread tracking.
 *
 * A single row per (user, channel) holding a cursor and a mention counter. Because
 * message ids are UUIDv7, "has unread" is a comparison rather than a COUNT — the
 * difference between an index probe and a scan, and the reason Discord rebuilt this
 * subsystem separately from message storage.
 *
 * The cursor only ever moves forward (GREATEST), so acks arriving out of order from
 * two devices can't rewind someone's unread line.
 */

import { query, queryOne, type Queryable } from '../db/pool.ts';
import { pool } from '../db/pool.ts';
import * as hub from '../realtime/hub.ts';

export interface ReadState {
  channelId: string;
  lastReadMessageId: string | null;
  mentionCount: number;
}

export async function markRead(
  userId: string,
  channelId: string,
  lastReadMessageId: string,
): Promise<ReadState> {
  const row = await queryOne<{
    last_read_message_id: string | null;
    mention_count: number;
  }>(
    `INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count, updated_at)
     VALUES ($1, $2, $3, 0, now())
     ON CONFLICT (user_id, channel_id) DO UPDATE
       SET last_read_message_id = GREATEST(
             read_states.last_read_message_id, EXCLUDED.last_read_message_id),
           mention_count = 0,
           updated_at = now()
     RETURNING last_read_message_id, mention_count`,
    [userId, channelId, lastReadMessageId],
  );

  const state: ReadState = {
    channelId,
    lastReadMessageId: row?.last_read_message_id ?? lastReadMessageId,
    mentionCount: row?.mention_count ?? 0,
  };

  // Other devices belonging to this user need to clear their badge too.
  hub.toUsers([userId], { t: 'read_state.updated', ...state });
  return state;
}

/** Advance the author's own cursor so their own message never shows as unread. */
export async function advanceForAuthor(
  userId: string,
  channelId: string,
  messageId: string,
  client: Queryable = pool,
): Promise<void> {
  await query(
    `INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, channel_id) DO UPDATE
       SET last_read_message_id = GREATEST(
             read_states.last_read_message_id, EXCLUDED.last_read_message_id),
           updated_at = now()`,
    [userId, channelId, messageId],
    client,
  );
}

/** Called by the notify worker for each recipient a message actually pings. */
export async function incrementMentions(userIds: string[], channelId: string): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await query<{ user_id: string; last_read_message_id: string | null; mention_count: number }>(
    `INSERT INTO read_states (user_id, channel_id, mention_count, updated_at)
     SELECT unnest($1::uuid[]), $2, 1, now()
     ON CONFLICT (user_id, channel_id) DO UPDATE
       SET mention_count = read_states.mention_count + 1,
           updated_at = now()
     RETURNING user_id, last_read_message_id, mention_count`,
    [userIds, channelId],
  );

  for (const row of rows) {
    hub.toUsers([row.user_id], {
      t: 'read_state.updated',
      channelId,
      lastReadMessageId: row.last_read_message_id,
      mentionCount: row.mention_count,
    });
  }
}

export async function listForUser(userId: string, channelIds?: string[]): Promise<ReadState[]> {
  const rows = await query<{
    channel_id: string;
    last_read_message_id: string | null;
    mention_count: number;
  }>(
    `SELECT channel_id, last_read_message_id, mention_count
       FROM read_states
      WHERE user_id = $1
        AND ($2::uuid[] IS NULL OR channel_id = ANY($2::uuid[]))`,
    [userId, channelIds ?? null],
  );
  return rows.map((r) => ({
    channelId: r.channel_id,
    lastReadMessageId: r.last_read_message_id,
    mentionCount: r.mention_count,
  }));
}

/** Total badge across the workspace — what the tab title and favicon show. */
export async function totalMentions(userId: string): Promise<number> {
  const row = await queryOne<{ total: number }>(
    'SELECT COALESCE(sum(mention_count), 0)::int AS total FROM read_states WHERE user_id = $1',
    [userId],
  );
  return row?.total ?? 0;
}
