/**
 * WebSocket protocol.
 *
 * The socket only *delivers* events — every write goes through REST, so a socket
 * outage degrades to "no live updates" rather than to data loss, and the client
 * can always resync over HTTP. See §5.4 of TEAM-CHAT-BUILD-PLAN.md.
 */

import type {
  Channel,
  ChannelWithState,
  Message,
  NotifyLevel,
  PresenceState,
  User,
  UserGroup,
} from './types.ts';

/** Frames the server sends. */
export type ServerEvent =
  | { t: 'hello'; userId: string; serverTime: string }
  | { t: 'pong' }
  | { t: 'message.new'; message: Message }
  | { t: 'message.updated'; message: Message }
  | { t: 'message.deleted'; id: string; channelId: string; threadRootId: string | null }
  | {
      t: 'reaction.added' | 'reaction.removed';
      messageId: string;
      channelId: string;
      emoji: string;
      userId: string;
    }
  | {
      t: 'thread.updated';
      rootId: string;
      channelId: string;
      replyCount: number;
      replyUserIds: string[];
      lastReplyAt: string | null;
    }
  | { t: 'channel.created' | 'channel.updated'; channel: ChannelWithState }
  | { t: 'channel.archived'; channelId: string }
  | { t: 'member.joined' | 'member.left'; channelId: string; userId: string }
  | { t: 'typing'; channelId: string; userId: string; threadRootId: string | null }
  | { t: 'presence'; userId: string; state: PresenceState }
  | { t: 'user.updated'; user: User }
  | { t: 'group.upserted'; group: UserGroup }
  | { t: 'group.deleted'; groupId: string }
  /** Per-viewer: whether *you* are in it, which cannot ride a shared payload. */
  | { t: 'group.membership'; groupId: string; isMember: boolean }
  | {
      t: 'read_state.updated';
      channelId: string;
      lastReadMessageId: string | null;
      mentionCount: number;
    }
  | { t: 'error'; code: string; message: string };

/** Frames the client sends. */
export type ClientFrame =
  | { t: 'ping' }
  /** Replaces this connection's presence subscription set (Slack's presence_sub). */
  | { t: 'presence.sub'; userIds: string[] }
  | { t: 'typing'; channelId: string; threadRootId?: string | null }
  /** Which channel the user is looking at — used to suppress redundant pushes. */
  | { t: 'channel.focus'; channelId: string | null };

export const WS_PATH = '/ws';
/** Client heartbeat interval; the server drops a connection after 2 missed beats. */
export const HEARTBEAT_MS = 25_000;
/** Typing indicator lifetime, matched by the Redis key TTL. */
export const TYPING_TTL_MS = 5_000;
/** A client may send at most one typing frame per this interval. */
export const TYPING_THROTTLE_MS = 3_000;

/** Response to GET /api/sync — the reconnect delta. */
export interface SyncResponse {
  /** Channels where the gap was too large to replay; refetch their tail. */
  resyncChannelIds: string[];
  messages: Message[];
  channels: ChannelWithState[];
  readStates: {
    channelId: string;
    lastReadMessageId: string | null;
    mentionCount: number;
  }[];
}

/** Above this many missed messages in one channel we tell the client to refetch. */
export const MAX_REPLAY_PER_CHANNEL = 200;

export interface ChannelUpdatePayload {
  name?: string;
  topic?: string | null;
  description?: string | null;
}

export interface MembershipUpdatePayload {
  notifyLevel?: NotifyLevel;
  isStarred?: boolean;
}

export type { Channel };
