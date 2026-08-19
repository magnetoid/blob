/** Database rows → API shapes. One place, so no route invents its own field names. */

import type {
  Attachment,
  Channel,
  ChannelWithState,
  CurrentUser,
  LinkPreview,
  Message,
  Reaction,
  User,
  UserPrefs,
} from '@blob/shared';
import { DEFAULT_PREFS } from '@blob/shared';
import { publicFileUrl } from '../lib/storage.ts';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  full_name: string | null;
  title: string | null;
  avatar_key: string | null;
  timezone: string;
  role: User['role'];
  status_emoji: string | null;
  status_text: string | null;
  status_expires_at: string | null;
  prefs: Partial<UserPrefs> | null;
  deactivated_at: string | null;
}

export function toUser(row: UserRow): User {
  // A status that has expired is simply not shown; no cleanup job needed.
  const expired =
    row.status_expires_at !== null && new Date(row.status_expires_at).getTime() < Date.now();
  return {
    id: row.id,
    displayName: row.display_name,
    fullName: row.full_name,
    title: row.title,
    avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : null,
    timezone: row.timezone,
    role: row.role,
    statusEmoji: expired ? null : row.status_emoji,
    statusText: expired ? null : row.status_text,
    statusExpiresAt: expired ? null : row.status_expires_at,
    deactivated: row.deactivated_at !== null,
  };
}

export function toCurrentUser(row: UserRow): CurrentUser {
  return {
    ...toUser(row),
    email: row.email,
    prefs: { ...DEFAULT_PREFS, ...(row.prefs ?? {}) },
  };
}

export interface ChannelRow {
  id: string;
  kind: Channel['kind'];
  name: string | null;
  topic: string | null;
  description: string | null;
  created_by: string | null;
  archived_at: string | null;
  last_message_id: string | null;
  created_at: string;
  member_ids?: string[] | null;
}

export function toChannel(row: ChannelRow): Channel {
  const channel: Channel = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    topic: row.topic,
    description: row.description,
    createdBy: row.created_by,
    archivedAt: row.archived_at,
    lastMessageId: row.last_message_id,
    createdAt: row.created_at,
  };
  if (row.member_ids) channel.memberIds = row.member_ids;
  return channel;
}

export interface ChannelStateRow extends ChannelRow {
  notify_level: ChannelWithState['membership'] extends infer M
    ? M extends { notifyLevel: infer L }
      ? L
      : never
    : never;
  is_starred: boolean | null;
  joined_at: string | null;
  last_read_message_id: string | null;
  mention_count: number | null;
}

export function toChannelWithState(row: ChannelStateRow): ChannelWithState {
  const lastRead = row.last_read_message_id;
  return {
    ...toChannel(row),
    membership: row.joined_at
      ? {
          notifyLevel: row.notify_level ?? 'mentions',
          isStarred: row.is_starred ?? false,
          joinedAt: row.joined_at,
        }
      : null,
    // UUIDv7 sorts chronologically, so this comparison *is* the unread check.
    hasUnread: Boolean(row.last_message_id && (!lastRead || row.last_message_id > lastRead)),
    mentionCount: row.mention_count ?? 0,
    lastReadMessageId: lastRead,
  };
}

export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string | null;
  kind: Message['kind'];
  body: string;
  thread_root_id: string | null;
  also_in_channel: boolean;
  reply_count: number;
  reply_user_ids: string[];
  last_reply_at: string | null;
  mention_user_ids: string[];
  mentions_everyone: boolean;
  client_msg_id: string;
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  created_at: string;
  link_preview: LinkPreview | null;
  reactions?: { emoji: string; user_ids: string[] }[] | null;
  attachments?: AttachmentRow[] | null;
}

export interface AttachmentRow {
  id: string;
  object_key: string;
  thumb_key: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    url: publicFileUrl(row.object_key),
    thumbUrl: row.thumb_key ? publicFileUrl(row.thumb_key) : null,
  };
}

export function toMessage(row: MessageRow): Message {
  const reactions: Reaction[] = (row.reactions ?? [])
    .filter((r) => r && r.emoji)
    .map((r) => ({ emoji: r.emoji, userIds: r.user_ids ?? [] }));

  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    kind: row.kind,
    // A deleted message keeps its row (threads hang off it) but loses its content.
    body: row.deleted_at ? '' : row.body,
    threadRootId: row.thread_root_id,
    alsoInChannel: row.also_in_channel,
    replyCount: row.reply_count,
    replyUserIds: row.reply_user_ids ?? [],
    lastReplyAt: row.last_reply_at,
    mentionUserIds: row.mention_user_ids ?? [],
    mentionsEveryone: row.mentions_everyone,
    clientMsgId: row.client_msg_id,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    pinnedAt: row.pinned_at,
    createdAt: row.created_at,
    reactions,
    attachments: row.deleted_at ? [] : (row.attachments ?? []).filter(Boolean).map(toAttachment),
    linkPreview: row.deleted_at ? null : row.link_preview,
  };
}

/** SQL fragment that aggregates reactions and attachments onto a message row. */
export const MESSAGE_SELECT = `
  m.*,
  COALESCE((
    SELECT json_agg(json_build_object('emoji', r.emoji, 'user_ids', r.user_ids)
                    ORDER BY r.first_at)
      FROM (
        SELECT emoji,
               array_agg(user_id ORDER BY created_at) AS user_ids,
               min(created_at) AS first_at
          FROM reactions
         WHERE message_id = m.id
         GROUP BY emoji
      ) r
  ), '[]'::json) AS reactions,
  COALESCE((
    SELECT json_agg(json_build_object(
             'id', a.id, 'object_key', a.object_key, 'thumb_key', a.thumb_key,
             'filename', a.filename, 'mime', a.mime, 'size_bytes', a.size_bytes,
             'width', a.width, 'height', a.height) ORDER BY a.created_at)
      FROM attachments a
     WHERE a.message_id = m.id
  ), '[]'::json) AS attachments
`;
