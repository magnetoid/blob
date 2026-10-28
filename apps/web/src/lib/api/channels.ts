/** `api.channels` — see `lib/api.ts` for the assembled client. */

import type {
  BrowsableChannel,
  ScheduledMessage,
  ScheduleRepeat,
  ChannelWithState,
  Message,
  NotifyLevel,
} from "@blob/shared";
import { get, post, patch } from "./client.ts";

export const channels = {
  create: (input: {
    name: string;
    kind: "public" | "private";
    topic?: string;
    memberIds?: string[];
  }) => post<{ channel: ChannelWithState }>("/api/channels", input),
  update: (
    id: string,
    input: {
      name?: string;
      topic?: string | null;
      description?: string | null;
      nudgeUnanswered?: boolean;
      posting?: "everyone" | "admins";
    },
  ) => patch<{ channel: ChannelWithState }>(`/api/channels/${id}`, input),
  join: (id: string) =>
    post<{ channel: ChannelWithState }>(`/api/channels/${id}/join`),
  leave: (id: string) => post<{ ok: true }>(`/api/channels/${id}/leave`),
  archive: (id: string) => post<{ ok: true }>(`/api/channels/${id}/archive`),
  members: (id: string) =>
    get<{ userIds: string[] }>(`/api/channels/${id}/members`),
  addMembers: (id: string, userIds: string[]) =>
    post<{ ok: true }>(`/api/channels/${id}/members`, { userIds }),
  setMembership: (
    id: string,
    input: { notifyLevel?: NotifyLevel; isStarred?: boolean },
  ) =>
    patch<{ channel: ChannelWithState }>(
      `/api/channels/${id}/membership`,
      input,
    ),
  pins: (id: string) =>
    get<{ messages: Message[] }>(`/api/channels/${id}/pins`),
  browse: (query: string, archived: boolean) =>
    get<{ channels: BrowsableChannel[] }>(
      `/api/channels/browse?q=${encodeURIComponent(query)}&archived=${archived}`,
    ),
  markUnread: (id: string, messageId: string) =>
    post<{
      readState: {
        channelId: string;
        lastReadMessageId: string | null;
        mentionCount: number;
      };
    }>(`/api/channels/${id}/unread`, { messageId }),
  markRead: (id: string, lastReadMessageId: string) =>
    post<{
      readState: {
        channelId: string;
        lastReadMessageId: string;
        mentionCount: number;
      };
    }>(`/api/channels/${id}/read`, { lastReadMessageId }),
  schedule: (
    channelId: string,
    input: {
      body: string;
      sendAt: string;
      clientMsgId: string;
      threadRootId?: string | null;
      repeat?: ScheduleRepeat | null;
      timezone?: string;
    },
  ) =>
    post<{ scheduled: ScheduledMessage }>(
      `/api/channels/${channelId}/schedule`,
      input,
    ),
  /** Everything, everywhere. Answers with only the channels that actually moved. */
  markAllRead: () =>
    post<{
      readStates: Array<{
        channelId: string;
        lastReadMessageId: string;
        mentionCount: number;
      }>;
    }>("/api/read-states/all", {}),
};
