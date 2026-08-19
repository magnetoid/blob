/**
 * Message endpoints.
 *
 * Note the shape of every write: do the database work, let it commit, *then*
 * broadcast and enqueue. Nothing in this file emits inside a transaction.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  editMessageSchema,
  historyQuerySchema,
  markReadSchema,
  reactionSchema,
  sendMessageSchema,
} from '@blob/shared';
import { requireUser } from '../lib/auth.ts';
import { consume } from '../lib/rate-limit.ts';
import { enqueue } from '../lib/queue.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import * as channels from '../services/channels.ts';
import * as messages from '../services/messages.ts';
import * as readState from '../services/read-state.ts';
import * as hub from '../realtime/hub.ts';

const channelParam = z.object({ id: z.string().uuid() });
const messageParam = z.object({ id: z.string().uuid() });

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/channels/:id/messages', async (req) => {
    const user = requireUser(req);
    const { id } = channelParam.parse(req.params);
    const opts = historyQuerySchema.parse(req.query);
    await channels.assertChannelAccess(user.id, id);
    return messages.history(id, opts);
  });

  app.post('/api/channels/:id/messages', async (req, reply) => {
    const user = requireUser(req);
    const { id } = channelParam.parse(req.params);
    const input = sendMessageSchema.parse(req.body);
    await consume('sendMessage', user.id);

    await channels.assertChannelAccess(user.id, id, {
      requireMember: true,
      requireWritable: true,
    });

    const result = await messages.send({
      workspaceId: user.workspaceId,
      channelId: id,
      authorId: user.id,
      body: input.body,
      clientMsgId: input.clientMsgId,
      threadRootId: input.threadRootId ?? null,
      alsoInChannel: input.alsoInChannel ?? false,
      attachmentIds: input.attachmentIds ?? [],
    });

    // Retries of the same client_msg_id return the stored row and broadcast nothing.
    if (result.created) {
      hub.toChannel(id, { t: 'message.new', message: result.message });
      if (result.threadUpdate) {
        hub.toChannel(id, { t: 'thread.updated', ...result.threadUpdate });
      }
      enqueue('notify', { messageId: result.message.id });
      if (/https?:\/\//.test(input.body)) enqueue('unfurl', { messageId: result.message.id });
    }

    reply.code(result.created ? 201 : 200);
    return { message: result.message };
  });

  app.get('/api/messages/:id/thread', async (req) => {
    const user = requireUser(req);
    const { id } = messageParam.parse(req.params);
    const root = await messages.byId(id);
    if (!root) throw notFound('That thread no longer exists.');
    await channels.assertChannelAccess(user.id, root.channelId);
    return { messages: await messages.thread(id) };
  });

  /** Threads the user started or replied to — the sidebar's Threads view. */
  app.get('/api/threads', async (req) => {
    const user = requireUser(req);
    return { messages: await messages.threadsForUser(user.id) };
  });

  app.patch('/api/messages/:id', async (req) => {
    const user = requireUser(req);
    const { id } = messageParam.parse(req.params);
    const input = editMessageSchema.parse(req.body);

    const existing = await messages.byId(id);
    if (!existing) throw notFound('That message is gone.');
    await channels.assertChannelAccess(user.id, existing.channelId, { requireMember: true });

    const message = await messages.edit(id, user.id, user.workspaceId, input.body);
    hub.toChannel(message.channelId, { t: 'message.updated', message });
    return { message };
  });

  app.delete('/api/messages/:id', async (req) => {
    const user = requireUser(req);
    const { id } = messageParam.parse(req.params);
    const isAdmin = user.role === 'admin' || user.role === 'owner';

    const existing = await messages.byId(id);
    if (!existing) throw notFound('That message is gone.');
    await channels.assertChannelAccess(user.id, existing.channelId, { requireMember: true });

    const { channelId, threadRootId } = await messages.remove(id, user.id, isAdmin);
    hub.toChannel(channelId, { t: 'message.deleted', id, channelId, threadRootId });
    return { ok: true };
  });

  app.put('/api/messages/:id/pin', async (req) => {
    const user = requireUser(req);
    const { id } = messageParam.parse(req.params);
    const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);

    const existing = await messages.byId(id);
    if (!existing) throw notFound('That message is gone.');
    await channels.assertChannelAccess(user.id, existing.channelId, {
      requireMember: true,
      requireWritable: true,
    });

    const message = await messages.setPinned(id, user.id, pinned);
    hub.toChannel(message.channelId, { t: 'message.updated', message });
    return { message };
  });

  // ─── reactions ────────────────────────────────────────────────────────────
  app.put('/api/messages/:id/reactions', async (req) => {
    const user = requireUser(req);
    const { id } = messageParam.parse(req.params);
    const { emoji } = reactionSchema.parse(req.body);

    const existing = await messages.byId(id);
    if (!existing || existing.deletedAt) throw notFound('That message is gone.');
    await channels.assertChannelAccess(user.id, existing.channelId, {
      requireMember: true,
      requireWritable: true,
    });

    if (await messages.addReaction(id, user.id, emoji)) {
      hub.toChannel(existing.channelId, {
        t: 'reaction.added',
        messageId: id,
        channelId: existing.channelId,
        emoji,
        userId: user.id,
      });
    }
    return { ok: true };
  });

  app.delete('/api/messages/:id/reactions', async (req) => {
    const user = requireUser(req);
    const { id } = messageParam.parse(req.params);
    const { emoji } = reactionSchema.parse(req.query);

    const existing = await messages.byId(id);
    if (!existing) throw notFound('That message is gone.');

    if (await messages.removeReaction(id, user.id, emoji)) {
      hub.toChannel(existing.channelId, {
        t: 'reaction.removed',
        messageId: id,
        channelId: existing.channelId,
        emoji,
        userId: user.id,
      });
    }
    return { ok: true };
  });

  // ─── read state ───────────────────────────────────────────────────────────
  app.post('/api/channels/:id/read', async (req) => {
    const user = requireUser(req);
    const { id } = channelParam.parse(req.params);
    const input = markReadSchema.parse(req.body);
    await channels.assertChannelAccess(user.id, id, { requireMember: true });
    return { readState: await readState.markRead(user.id, id, input.lastReadMessageId) };
  });

  app.get('/api/read-states', async (req) => {
    const user = requireUser(req);
    return {
      readStates: await readState.listForUser(user.id),
      totalMentions: await readState.totalMentions(user.id),
    };
  });

  /** Incoming webhook: post to a channel with a token instead of a session. */
  app.post('/api/hooks/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(req.params);
    const { text, username } = z
      .object({ text: z.string().min(1).max(12_000), username: z.string().max(40).optional() })
      .parse(req.body);

    await consume('webhook', token.slice(0, 16));

    const { hashToken } = await import('../lib/auth.ts');
    const { queryOne, query } = await import('../db/pool.ts');
    const hook = await queryOne<{
      id: string;
      workspace_id: string;
      channel_id: string;
      created_by: string;
      name: string;
    }>(
      `SELECT id, workspace_id, channel_id, created_by, name
         FROM webhooks WHERE token_hash = $1`,
      [hashToken(token)],
    );
    if (!hook) throw forbidden('That webhook is not valid.');

    const result = await messages.send({
      workspaceId: hook.workspace_id,
      channelId: hook.channel_id,
      authorId: hook.created_by,
      kind: 'bot',
      body: username ? `**${username}**\n${text}` : text,
      clientMsgId: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    });

    await query('UPDATE webhooks SET last_used_at = now() WHERE id = $1', [hook.id]);

    if (result.created) {
      hub.toChannel(hook.channel_id, { t: 'message.new', message: result.message });
      enqueue('notify', { messageId: result.message.id });
    }
    reply.code(202);
    return { ok: true };
  });
}
