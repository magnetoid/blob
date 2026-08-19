/**
 * Channel membership and access.
 *
 * `assertChannelAccess` is the single authorization path for anything channel-scoped.
 * One helper means one place to audit and one place to test.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ChannelWithState } from '@blob/shared';
import { pool, query, queryOne, transaction, type Queryable } from '../db/pool.ts';
import { newId } from '../lib/ids.ts';
import { forbidden, notFound, conflict } from '../lib/errors.ts';
import { toChannelWithState, type ChannelStateRow } from './serialize.ts';

/** Channels every new member joins automatically. */
export const DEFAULT_CHANNELS = ['general', 'random'] as const;

const CHANNEL_STATE_SELECT = `
  SELECT c.id, c.kind, c.name, c.topic, c.description, c.created_by,
         c.archived_at, c.last_message_id, c.created_at,
         cm.notify_level, cm.is_starred, cm.joined_at,
         rs.last_read_message_id, rs.mention_count,
         CASE WHEN c.kind IN ('dm', 'group_dm')
              THEN (SELECT array_agg(m2.user_id) FROM channel_members m2 WHERE m2.channel_id = c.id)
              ELSE NULL END AS member_ids
    FROM channels c
    LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
    LEFT JOIN read_states  rs ON rs.channel_id = c.id AND rs.user_id = $1
`;

/** Channels the user belongs to, plus public channels they could join. */
export async function listForUser(
  userId: string,
  workspaceId: string,
): Promise<ChannelWithState[]> {
  const rows = await query<ChannelStateRow>(
    `${CHANNEL_STATE_SELECT}
      WHERE c.workspace_id = $2
        AND (cm.user_id IS NOT NULL OR (c.kind = 'public' AND c.archived_at IS NULL))
      ORDER BY c.kind, lower(c.name) NULLS LAST, c.created_at`,
    [userId, workspaceId],
  );
  return rows.map(toChannelWithState);
}

export async function getForUser(
  channelId: string,
  userId: string,
): Promise<ChannelWithState | null> {
  const row = await queryOne<ChannelStateRow>(`${CHANNEL_STATE_SELECT} WHERE c.id = $2`, [
    userId,
    channelId,
  ]);
  return row ? toChannelWithState(row) : null;
}

export interface ChannelAccess {
  channelId: string;
  kind: 'public' | 'private' | 'dm' | 'group_dm';
  workspaceId: string;
  isMember: boolean;
  archived: boolean;
}

/**
 * Authorize a user against a channel.
 *
 * Private channels and DMs report 404 rather than 403 to non-members — their very
 * existence is private.
 */
export async function assertChannelAccess(
  userId: string,
  channelId: string,
  opts: { requireMember?: boolean; requireWritable?: boolean } = {},
  client: Queryable = pool,
): Promise<ChannelAccess> {
  const row = await queryOne<{
    id: string;
    kind: ChannelAccess['kind'];
    workspace_id: string;
    archived_at: string | null;
    member: string | null;
  }>(
    `SELECT c.id, c.kind, c.workspace_id, c.archived_at, cm.user_id AS member
       FROM channels c
       LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
      WHERE c.id = $2`,
    [userId, channelId],
    client,
  );

  if (!row) throw notFound('That channel no longer exists.');

  const isMember = row.member !== null;
  const isPublic = row.kind === 'public';

  if (!isMember && !isPublic) throw notFound('That channel no longer exists.');
  if (!isMember && opts.requireMember) throw forbidden('Join the channel first.');
  if (opts.requireWritable && row.archived_at) {
    throw forbidden('This channel is archived and read-only.');
  }

  return {
    channelId: row.id,
    kind: row.kind,
    workspaceId: row.workspace_id,
    isMember,
    archived: row.archived_at !== null,
  };
}

export async function memberIds(channelId: string, client: Queryable = pool): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    'SELECT user_id FROM channel_members WHERE channel_id = $1',
    [channelId],
    client,
  );
  return rows.map((r) => r.user_id);
}

export async function createChannel(input: {
  workspaceId: string;
  createdBy: string;
  name: string;
  kind: 'public' | 'private';
  topic?: string | null;
  description?: string | null;
  memberIds?: string[];
}): Promise<string> {
  const channelId = newId();
  const members = new Set([input.createdBy, ...(input.memberIds ?? [])]);

  await transaction(async (client) => {
    try {
      await client.query(
        `INSERT INTO channels (id, workspace_id, kind, name, topic, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          channelId,
          input.workspaceId,
          input.kind,
          input.name,
          input.topic ?? null,
          input.description ?? null,
          input.createdBy,
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw conflict(`#${input.name} already exists.`, 'channel_exists');
      }
      throw err;
    }
    await addMembers(channelId, [...members], client);
  });

  return channelId;
}

export async function addMembers(
  channelId: string,
  userIds: string[],
  client: PoolClient,
): Promise<void> {
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO channel_members (channel_id, user_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [channelId, userIds],
  );
  // A fresh member starts with a clean slate rather than every message unread.
  await client.query(
    `INSERT INTO read_states (user_id, channel_id, last_read_message_id)
     SELECT unnest($2::uuid[]), $1, (SELECT last_message_id FROM channels WHERE id = $1)
     ON CONFLICT DO NOTHING`,
    [channelId, userIds],
  );
}

export async function join(channelId: string, userId: string): Promise<void> {
  await transaction(async (client) => {
    await addMembers(channelId, [userId], client);
  });
}

export async function leave(channelId: string, userId: string): Promise<void> {
  await query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [
    channelId,
    userId,
  ]);
}

/** DMs are addressed by their member set, so opening one twice returns the same channel. */
export function dmKey(userIds: string[]): string {
  const sorted = [...new Set(userIds)].sort();
  return createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 32);
}

export async function findOrCreateDm(
  workspaceId: string,
  userIds: string[],
): Promise<{ channelId: string; created: boolean }> {
  const members = [...new Set(userIds)].sort();
  const key = dmKey(members);
  const kind = members.length > 2 ? 'group_dm' : 'dm';

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM channels WHERE workspace_id = $1 AND dm_key = $2',
    [workspaceId, key],
  );
  if (existing) return { channelId: existing.id, created: false };

  const channelId = newId();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO channels (id, workspace_id, kind, dm_key, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, dm_key) WHERE dm_key IS NOT NULL DO NOTHING`,
      [channelId, workspaceId, kind, key, members[0]],
    );
    await addMembers(channelId, members, client);
  });

  // Another request may have won the race; re-read to get the surviving row.
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM channels WHERE workspace_id = $1 AND dm_key = $2',
    [workspaceId, key],
  );
  return { channelId: row?.id ?? channelId, created: row?.id === channelId };
}
