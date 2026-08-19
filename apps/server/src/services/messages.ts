/**
 * Message reads and writes.
 *
 * The send path is the heart of the app; the sequence in `send` below is deliberate:
 * persist inside a transaction, then broadcast and enqueue *after* it commits. An
 * event emitted mid-transaction lets a client fetch a message the database hasn't
 * committed yet — the bug Zulip's send_event_on_commit exists to prevent.
 */

import type { Message } from '@blob/shared';
import { parseMentions } from '@blob/shared';
import { pool, query, queryOne, transaction, type Queryable } from '../db/pool.ts';
import { newId } from '../lib/ids.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { MESSAGE_SELECT, toMessage, type MessageRow } from './serialize.ts';

export interface SendInput {
  workspaceId: string;
  channelId: string;
  authorId: string;
  body: string;
  clientMsgId: string;
  threadRootId?: string | null;
  alsoInChannel?: boolean;
  attachmentIds?: string[];
  kind?: 'user' | 'bot' | 'system';
}

export interface SendResult {
  message: Message;
  /** False when this was a retry of an already-stored message. */
  created: boolean;
  /** Present when the message was a thread reply; clients update the summary line. */
  threadUpdate: {
    rootId: string;
    channelId: string;
    replyCount: number;
    replyUserIds: string[];
    lastReplyAt: string | null;
  } | null;
}

/** Avatars shown on a thread's summary line. */
const FACEPILE_LIMIT = 5;

export async function send(input: SendInput): Promise<SendResult> {
  const messageId = newId();
  const body = input.body ?? '';

  const nameToId = await displayNameIndex(input.workspaceId);
  const mentions = parseMentions(body, nameToId);

  const result = await transaction(async (client) => {
    if (input.threadRootId) {
      const root = await queryOne<{ id: string; channel_id: string; deleted_at: string | null }>(
        'SELECT id, channel_id, deleted_at FROM messages WHERE id = $1',
        [input.threadRootId],
        client,
      );
      if (!root || root.channel_id !== input.channelId) {
        throw notFound('That thread no longer exists.');
      }
    }

    // Idempotency: a retry of the same client_msg_id stores nothing new.
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO messages (
         id, workspace_id, channel_id, author_id, kind, body, thread_root_id,
         also_in_channel, mention_user_ids, mentions_everyone, client_msg_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (channel_id, author_id, client_msg_id) DO NOTHING
       RETURNING id`,
      [
        messageId,
        input.workspaceId,
        input.channelId,
        input.authorId,
        input.kind ?? 'user',
        body,
        input.threadRootId ?? null,
        input.alsoInChannel ?? false,
        mentions.userIds,
        mentions.everyone,
        input.clientMsgId,
      ],
      client,
    );

    if (!inserted) {
      const existing = await loadRow(
        `SELECT ${MESSAGE_SELECT} FROM messages m
          WHERE m.channel_id = $1 AND m.author_id = $2 AND m.client_msg_id = $3`,
        [input.channelId, input.authorId, input.clientMsgId],
        client,
      );
      if (!existing) throw badRequest('Could not store that message.');
      return { row: existing, created: false, threadUpdate: null };
    }

    if (input.attachmentIds?.length) {
      // Only the uploader's own unbound attachments can be attached.
      const bound = await query<{ id: string }>(
        `UPDATE attachments SET message_id = $1
          WHERE id = ANY($2::uuid[]) AND uploader_id = $3 AND message_id IS NULL
          RETURNING id`,
        [messageId, input.attachmentIds, input.authorId],
        client,
      );
      if (bound.length !== input.attachmentIds.length) {
        throw badRequest('One of those attachments is no longer available.');
      }
    }

    await client.query('UPDATE channels SET last_message_id = $1 WHERE id = $2', [
      messageId,
      input.channelId,
    ]);

    let threadUpdate: SendResult['threadUpdate'] = null;
    if (input.threadRootId) {
      const root = await queryOne<{
        reply_count: number;
        reply_user_ids: string[];
        last_reply_at: string | null;
      }>(
        `UPDATE messages
            SET reply_count = reply_count + 1,
                last_reply_at = now(),
                reply_user_ids = CASE
                  WHEN $2::uuid = ANY(reply_user_ids) THEN reply_user_ids
                  WHEN array_length(reply_user_ids, 1) >= $3 THEN reply_user_ids
                  ELSE array_append(reply_user_ids, $2::uuid)
                END
          WHERE id = $1
          RETURNING reply_count, reply_user_ids, last_reply_at`,
        [input.threadRootId, input.authorId, FACEPILE_LIMIT],
        client,
      );

      // Replying subscribes you to the thread, the way every chat app behaves.
      await client.query(
        `INSERT INTO thread_subscriptions (user_id, thread_root_id, last_read_reply_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, thread_root_id)
           DO UPDATE SET last_read_reply_id = EXCLUDED.last_read_reply_id`,
        [input.authorId, input.threadRootId, messageId],
      );

      if (root) {
        threadUpdate = {
          rootId: input.threadRootId,
          channelId: input.channelId,
          replyCount: root.reply_count,
          replyUserIds: root.reply_user_ids ?? [],
          lastReplyAt: root.last_reply_at,
        };
      }
    }

    // The author has, by definition, read their own message.
    await client.query(
      `INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, channel_id) DO UPDATE
         SET last_read_message_id = GREATEST(
               read_states.last_read_message_id, EXCLUDED.last_read_message_id),
             updated_at = now()`,
      [input.authorId, input.channelId, messageId],
    );

    const row = await loadRow(`SELECT ${MESSAGE_SELECT} FROM messages m WHERE m.id = $1`, [
      messageId,
    ], client);
    if (!row) throw badRequest('Could not store that message.');
    return { row, created: true, threadUpdate };
  });

  return {
    message: toMessage(result.row),
    created: result.created,
    threadUpdate: result.threadUpdate,
  };
}

export interface HistoryOptions {
  before?: string;
  after?: string;
  around?: string;
  limit: number;
}

/** Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes. */
export async function history(
  channelId: string,
  opts: HistoryOptions,
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const limit = Math.min(opts.limit, 100);

  if (opts.around) {
    // Jump-to-message: half a page either side of the target.
    const half = Math.floor(limit / 2);
    const rows = await query<MessageRow>(
      `(SELECT ${MESSAGE_SELECT} FROM messages m
         WHERE m.channel_id = $1 AND m.thread_root_id IS NULL AND m.id <= $2
         ORDER BY m.id DESC LIMIT $3)
       UNION ALL
       (SELECT ${MESSAGE_SELECT} FROM messages m
         WHERE m.channel_id = $1 AND m.thread_root_id IS NULL AND m.id > $2
         ORDER BY m.id ASC LIMIT $3)`,
      [channelId, opts.around, half],
    );
    const messages = rows.map(toMessage).sort((a, b) => (a.id < b.id ? -1 : 1));
    return { messages, hasMore: true };
  }

  const forward = Boolean(opts.after);
  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_SELECT} FROM messages m
      WHERE m.channel_id = $1
        AND m.thread_root_id IS NULL
        AND ($2::uuid IS NULL OR m.id < $2)
        AND ($3::uuid IS NULL OR m.id > $3)
      ORDER BY m.id ${forward ? 'ASC' : 'DESC'}
      LIMIT $4`,
    [channelId, opts.before ?? null, opts.after ?? null, limit + 1],
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const messages = page.map(toMessage).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { messages, hasMore };
}

/** A thread: its root plus every reply, oldest first. */
export async function thread(rootId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_SELECT} FROM messages m
      WHERE m.id = $1 OR m.thread_root_id = $1
      ORDER BY m.id ASC`,
    [rootId],
  );
  return rows.map(toMessage);
}

export async function byId(messageId: string, client: Queryable = pool): Promise<Message | null> {
  const row = await loadRow(`SELECT ${MESSAGE_SELECT} FROM messages m WHERE m.id = $1`, [
    messageId,
  ], client);
  return row ? toMessage(row) : null;
}

export async function edit(
  messageId: string,
  userId: string,
  workspaceId: string,
  body: string,
): Promise<Message> {
  const existing = await queryOne<{ author_id: string | null; deleted_at: string | null }>(
    'SELECT author_id, deleted_at FROM messages WHERE id = $1',
    [messageId],
  );
  if (!existing || existing.deleted_at) throw notFound('That message is gone.');
  if (existing.author_id !== userId) throw forbidden('You can only edit your own messages.');

  const nameToId = await displayNameIndex(workspaceId);
  const mentions = parseMentions(body, nameToId);

  await query(
    `UPDATE messages
        SET body = $2, edited_at = now(),
            mention_user_ids = $3, mentions_everyone = $4
      WHERE id = $1`,
    [messageId, body, mentions.userIds, mentions.everyone],
  );

  const message = await byId(messageId);
  if (!message) throw notFound('That message is gone.');
  return message;
}

/**
 * Soft delete. The row survives because thread replies reference it; the body and
 * attachments are cleared so nothing is recoverable through the API.
 */
export async function remove(
  messageId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ channelId: string; threadRootId: string | null }> {
  const existing = await queryOne<{
    author_id: string | null;
    channel_id: string;
    thread_root_id: string | null;
    deleted_at: string | null;
  }>('SELECT author_id, channel_id, thread_root_id, deleted_at FROM messages WHERE id = $1', [
    messageId,
  ]);
  if (!existing || existing.deleted_at) throw notFound('That message is gone.');
  if (existing.author_id !== userId && !isAdmin) {
    throw forbidden('You can only delete your own messages.');
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE messages
          SET deleted_at = now(), body = '', mention_user_ids = '{}', mentions_everyone = false
        WHERE id = $1`,
      [messageId],
    );
    await client.query('DELETE FROM reactions WHERE message_id = $1', [messageId]);
    if (existing.thread_root_id) {
      await client.query(
        `UPDATE messages SET reply_count = GREATEST(reply_count - 1, 0)
          WHERE id = $1`,
        [existing.thread_root_id],
      );
    }
  });

  return { channelId: existing.channel_id, threadRootId: existing.thread_root_id };
}

export async function setPinned(
  messageId: string,
  userId: string,
  pinned: boolean,
): Promise<Message> {
  await query(
    `UPDATE messages
        SET pinned_at = CASE WHEN $2 THEN now() ELSE NULL END,
            pinned_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END
      WHERE id = $1 AND deleted_at IS NULL`,
    [messageId, pinned, userId],
  );
  const message = await byId(messageId);
  if (!message) throw notFound('That message is gone.');
  return message;
}

export async function listPinned(channelId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_SELECT} FROM messages m
      WHERE m.channel_id = $1 AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL
      ORDER BY m.pinned_at DESC`,
    [channelId],
  );
  return rows.map(toMessage);
}

export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<boolean> {
  const rows = await query(
    `INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING message_id`,
    [messageId, userId, emoji],
  );
  return rows.length > 0;
}

export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<boolean> {
  const rows = await query(
    'DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING message_id',
    [messageId, userId, emoji],
  );
  return rows.length > 0;
}

/** Threads the user started or replied to, most recently active first. */
export async function threadsForUser(userId: string, limit = 30): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_SELECT} FROM messages m
       JOIN thread_subscriptions ts ON ts.thread_root_id = m.id AND ts.user_id = $1
      WHERE m.deleted_at IS NULL AND ts.muted = false
      ORDER BY m.last_reply_at DESC NULLS LAST
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toMessage);
}

/** Lowercased display name → user id, for mention resolution. */
async function displayNameIndex(workspaceId: string): Promise<Map<string, string>> {
  const rows = await query<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM users WHERE workspace_id = $1 AND deactivated_at IS NULL',
    [workspaceId],
  );
  return new Map(rows.map((r) => [r.display_name.toLowerCase(), r.id]));
}

async function loadRow(
  sql: string,
  params: unknown[],
  client: Queryable = pool,
): Promise<MessageRow | null> {
  return queryOne<MessageRow>(sql, params, client);
}
