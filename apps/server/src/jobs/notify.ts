/**
 * Deliver notifications for one message.
 *
 * Runs after the send transaction has committed, so it reads its own consistent view
 * and never blocks the sender. Push is debounced: someone with the channel open on
 * screen has already seen the message and gets nothing.
 */

import webpush from 'web-push';
import { config } from '../config.ts';
import { query, queryOne } from '../db/pool.ts';
import * as hub from '../realtime/hub.ts';
import * as notifyService from '../services/notify.ts';
import * as readState from '../services/read-state.ts';

if (config.pushEnabled) {
  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY as string,
    config.VAPID_PRIVATE_KEY as string,
  );
}

interface MessageContext {
  id: string;
  channel_id: string;
  channel_kind: 'public' | 'private' | 'dm' | 'group_dm';
  channel_name: string | null;
  author_id: string | null;
  author_name: string | null;
  body: string;
  mention_user_ids: string[];
  mentions_everyone: boolean;
  thread_root_id: string | null;
}

export async function handleNotify(messageId: string): Promise<void> {
  const message = await queryOne<MessageContext>(
    `SELECT m.id, m.channel_id, c.kind AS channel_kind, c.name AS channel_name,
            m.author_id, u.display_name AS author_name, m.body,
            m.mention_user_ids, m.mentions_everyone, m.thread_root_id
       FROM messages m
       JOIN channels c ON c.id = m.channel_id
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [messageId],
  );
  if (!message) return;

  const recipients = await notifyService.loadRecipients(message.channel_id);
  const threadSubscribers = message.thread_root_id
    ? await notifyService.loadThreadSubscribers(message.thread_root_id)
    : new Set<string>();

  const decisions = notifyService.decide(
    {
      id: message.id,
      channelId: message.channel_id,
      channelKind: message.channel_kind,
      authorId: message.author_id,
      body: message.body,
      mentionUserIds: message.mention_user_ids ?? [],
      mentionsEveryone: message.mentions_everyone,
      threadRootId: message.thread_root_id,
    },
    recipients,
    new Date(),
    threadSubscribers,
  );

  if (decisions.length === 0) return;

  const mentionUserIds = decisions.filter((d) => d.countsAsMention).map((d) => d.userId);
  await readState.incrementMentions(mentionUserIds, message.channel_id);

  // Someone looking at this very channel has already seen it; don't push at them.
  const needPush = decisions.filter((d) => !hub.focusedChannels(d.userId).has(message.channel_id));
  if (needPush.length > 0 && config.pushEnabled) {
    await sendPush(
      needPush.map((d) => d.userId),
      {
        title:
          message.channel_kind === 'dm' || message.channel_kind === 'group_dm'
            ? (message.author_name ?? 'New message')
            : `#${message.channel_name ?? 'channel'}`,
        body: `${message.author_name ? `${message.author_name}: ` : ''}${preview(message.body)}`,
        url: `/c/${message.channel_id}`,
        tag: message.channel_id,
      },
    );
  }
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

async function sendPush(userIds: string[], payload: PushPayload): Promise<void> {
  const subs = await query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])',
    [userIds],
  );

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away; stop trying.
        if (status === 404 || status === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        }
      }
    }),
  );
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}
