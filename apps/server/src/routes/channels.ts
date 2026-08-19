/** Channels, membership, and DM creation. */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createChannelSchema,
  createDmSchema,
  membershipUpdateSchema,
  updateChannelSchema,
} from '@blob/shared';
import { query, queryOne } from '../db/pool.ts';
import { requireUser } from '../lib/auth.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import * as channels from '../services/channels.ts';
import * as messages from '../services/messages.ts';
import * as hub from '../realtime/hub.ts';

const idParam = z.object({ id: z.string().uuid() });

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/channels', async (req) => {
    const user = requireUser(req);
    return { channels: await channels.listForUser(user.id, user.workspaceId) };
  });

  app.post('/api/channels', async (req) => {
    const user = requireUser(req);
    const input = createChannelSchema.parse(req.body);

    const channelId = await channels.createChannel({
      workspaceId: user.workspaceId,
      createdBy: user.id,
      name: input.name,
      kind: input.kind,
      topic: input.topic ?? null,
      description: input.description ?? null,
      memberIds: input.memberIds,
    });

    const channel = await channels.getForUser(channelId, user.id);
    if (!channel) throw notFound('Could not create that channel.');

    // Public channels appear in everyone's browser; private ones only for members.
    if (input.kind === 'public') {
      hub.toAll({ t: 'channel.created', channel });
    } else {
      hub.toUsers(await channels.memberIds(channelId), { t: 'channel.created', channel });
    }
    return { channel };
  });

  app.get('/api/channels/:id', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    await channels.assertChannelAccess(user.id, id);
    const channel = await channels.getForUser(id, user.id);
    if (!channel) throw notFound('That channel no longer exists.');
    return { channel };
  });

  app.patch('/api/channels/:id', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const input = updateChannelSchema.parse(req.body);
    const access = await channels.assertChannelAccess(user.id, id, {
      requireMember: true,
      requireWritable: true,
    });
    if (access.kind === 'dm' || access.kind === 'group_dm') {
      throw forbidden('Direct messages have no channel settings.');
    }

    await query(
      `UPDATE channels
          SET name = COALESCE($2, name),
              topic = CASE WHEN $3::boolean THEN $4 ELSE topic END,
              description = CASE WHEN $5::boolean THEN $6 ELSE description END
        WHERE id = $1`,
      [
        id,
        input.name ?? null,
        input.topic !== undefined,
        input.topic ?? null,
        input.description !== undefined,
        input.description ?? null,
      ],
    );

    const channel = await channels.getForUser(id, user.id);
    if (channel) hub.toChannel(id, { t: 'channel.updated', channel });
    return { channel };
  });

  app.post('/api/channels/:id/archive', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const access = await channels.assertChannelAccess(user.id, id, { requireMember: true });
    if (access.kind === 'dm' || access.kind === 'group_dm') {
      throw forbidden('Direct messages cannot be archived.');
    }
    await query('UPDATE channels SET archived_at = now() WHERE id = $1', [id]);
    hub.toChannel(id, { t: 'channel.archived', channelId: id });
    return { ok: true };
  });

  app.post('/api/channels/:id/join', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const access = await channels.assertChannelAccess(user.id, id, { requireWritable: true });
    if (access.kind !== 'public') throw forbidden('That channel is invitation-only.');

    await channels.join(id, user.id);
    hub.toChannel(id, { t: 'member.joined', channelId: id, userId: user.id });
    // Existing sockets for this user need to start receiving the channel's events.
    for (const conn of hub.connectionsForUser(user.id)) hub.subscribeChannels(conn, [id]);

    const channel = await channels.getForUser(id, user.id);
    return { channel };
  });

  app.post('/api/channels/:id/leave', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const access = await channels.assertChannelAccess(user.id, id, { requireMember: true });
    if (access.kind === 'dm' || access.kind === 'group_dm') {
      throw forbidden('You cannot leave a direct message.');
    }
    await channels.leave(id, user.id);
    for (const conn of hub.connectionsForUser(user.id)) hub.unsubscribeChannel(conn, id);
    hub.toChannel(id, { t: 'member.left', channelId: id, userId: user.id });
    return { ok: true };
  });

  app.post('/api/channels/:id/members', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const { userIds } = z.object({ userIds: z.array(z.string().uuid()).min(1).max(50) }).parse(
      req.body,
    );
    const access = await channels.assertChannelAccess(user.id, id, {
      requireMember: true,
      requireWritable: true,
    });
    if (access.kind === 'dm' || access.kind === 'group_dm') {
      throw forbidden('Start a new group message instead of adding people to this one.');
    }

    for (const userId of userIds) {
      await channels.join(id, userId);
      hub.toChannel(id, { t: 'member.joined', channelId: id, userId });
      for (const conn of hub.connectionsForUser(userId)) hub.subscribeChannels(conn, [id]);
      const channel = await channels.getForUser(id, userId);
      if (channel) hub.toUsers([userId], { t: 'channel.created', channel });
    }
    return { ok: true };
  });

  app.get('/api/channels/:id/members', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    await channels.assertChannelAccess(user.id, id);
    return { userIds: await channels.memberIds(id) };
  });

  /** Per-user channel settings: notification level and starring. */
  app.patch('/api/channels/:id/membership', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const input = membershipUpdateSchema.parse(req.body);
    await channels.assertChannelAccess(user.id, id, { requireMember: true });

    await query(
      `UPDATE channel_members
          SET notify_level = COALESCE($3, notify_level),
              is_starred   = COALESCE($4, is_starred)
        WHERE channel_id = $1 AND user_id = $2`,
      [id, user.id, input.notifyLevel ?? null, input.isStarred ?? null],
    );

    const channel = await channels.getForUser(id, user.id);
    if (channel) hub.toUsers([user.id], { t: 'channel.updated', channel });
    return { channel };
  });

  app.get('/api/channels/:id/pins', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    await channels.assertChannelAccess(user.id, id);
    return { messages: await messages.listPinned(id) };
  });

  /** Open (or reopen) a DM. Idempotent: the same member set returns the same channel. */
  app.post('/api/dms', async (req) => {
    const user = requireUser(req);
    const { userIds } = createDmSchema.parse(req.body);

    const members = [...new Set([user.id, ...userIds])];
    const valid = await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM users
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND deactivated_at IS NULL`,
      [members, user.workspaceId],
    );
    if ((valid?.count ?? 0) !== members.length) throw notFound('One of those people is unavailable.');

    const { channelId, created } = await channels.findOrCreateDm(user.workspaceId, members);
    const channel = await channels.getForUser(channelId, user.id);

    if (created) {
      for (const memberId of members) {
        for (const conn of hub.connectionsForUser(memberId)) {
          hub.subscribeChannels(conn, [channelId]);
        }
        const view = await channels.getForUser(channelId, memberId);
        if (view) hub.toUsers([memberId], { t: 'channel.created', channel: view });
      }
    }
    return { channel };
  });
}
