/** Search and reconnect sync. */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_REPLAY_PER_CHANNEL, type SyncResponse } from '@blob/shared';
import { query } from '../db/pool.ts';
import { requireUser } from '../lib/auth.ts';
import { consume } from '../lib/rate-limit.ts';
import * as channelService from '../services/channels.ts';
import * as readState from '../services/read-state.ts';
import { parseQuery, search } from '../services/search.ts';
import { MESSAGE_SELECT, toMessage, type MessageRow } from '../services/serialize.ts';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/search', async (req) => {
    const user = requireUser(req);
    const { q, limit } = z
      .object({ q: z.string().trim().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(25) })
      .parse(req.query);
    await consume('search', user.id);

    const parsed = parseQuery(q);
    if (!parsed.text) return { messages: [], total: 0, parsed };

    // Modifiers name people and channels by label; resolve them to ids.
    const [author, channel] = await Promise.all([
      parsed.from
        ? query<{ id: string }>(
            'SELECT id FROM users WHERE workspace_id = $1 AND lower(display_name) = lower($2)',
            [user.workspaceId, parsed.from],
          )
        : Promise.resolve([]),
      parsed.in
        ? query<{ id: string }>(
            'SELECT id FROM channels WHERE workspace_id = $1 AND lower(name) = lower($2)',
            [user.workspaceId, parsed.in],
          )
        : Promise.resolve([]),
    ]);

    const result = await search({
      workspaceId: user.workspaceId,
      userId: user.id,
      q: parsed.text,
      from: author[0]?.id,
      channelId: channel[0]?.id,
      before: parsed.before ? new Date(parsed.before).toISOString() : undefined,
      after: parsed.after ? new Date(parsed.after).toISOString() : undefined,
      has: parsed.has,
      limit,
    });

    return { ...result, parsed };
  });

  /**
   * Reconnect delta.
   *
   * The client sends its last-seen message id per channel; we return what it missed.
   * Past MAX_REPLAY_PER_CHANNEL we say "refetch this one" instead of replaying —
   * cheaper than streaming thousands of rows to a client that has been asleep.
   */
  app.get('/api/sync', async (req) => {
    const user = requireUser(req);
    const { cursors } = z
      .object({
        cursors: z
          .string()
          .optional()
          .transform((raw) => {
            if (!raw) return {} as Record<string, string>;
            try {
              const parsed = JSON.parse(raw) as Record<string, string>;
              return typeof parsed === 'object' && parsed ? parsed : {};
            } catch {
              return {} as Record<string, string>;
            }
          }),
      })
      .parse(req.query);

    const channels = await channelService.listForUser(user.id, user.workspaceId);
    const joined = channels.filter((c) => c.membership !== null);

    const resyncChannelIds: string[] = [];
    const messages: MessageRow[] = [];

    for (const channel of joined) {
      const cursor = cursors[channel.id];
      if (!cursor) continue;
      if (channel.lastMessageId && channel.lastMessageId <= cursor) continue;

      const rows = await query<MessageRow>(
        `SELECT ${MESSAGE_SELECT} FROM messages m
          WHERE m.channel_id = $1 AND m.id > $2
          ORDER BY m.id ASC LIMIT $3`,
        [channel.id, cursor, MAX_REPLAY_PER_CHANNEL + 1],
      );

      if (rows.length > MAX_REPLAY_PER_CHANNEL) {
        resyncChannelIds.push(channel.id);
        continue;
      }
      messages.push(...rows);
    }

    return {
      resyncChannelIds,
      messages: messages.map(toMessage),
      channels,
      readStates: await readState.listForUser(user.id),
    } satisfies SyncResponse;
  });
}
