/** `api.messages` — see `lib/api.ts` for the assembled client. */

import type {
  CommandResult,
  Message,
  MessageTranslation,
} from "@blob/shared";
import { get, post, patch, put, del } from "./client.ts";

export const messages = {
  history: (
    channelId: string,
    params: { before?: string; around?: string; limit?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.before) search.set("before", params.before);
    if (params.around) search.set("around", params.around);
    search.set("limit", String(params.limit ?? 50));
    return get<{ messages: Message[]; hasMore: boolean }>(
      `/api/channels/${channelId}/messages?${search}`,
    );
  },
  send: (
    channelId: string,
    input: {
      body: string;
      clientMsgId: string;
      threadRootId?: string | null;
      alsoInChannel?: boolean;
      attachmentIds?: string[];
      /** Asks the body as a poll with these options (ADR 0041). */
      poll?: { options: string[]; multiple?: boolean; anonymous?: boolean };
    },
  ) =>
    post<{ message: Message }>(`/api/channels/${channelId}/messages`, input),
  /**
   * Run a slash command.
   *
   * The whole text goes up with the leading slash still on it: the server owns the
   * command namespace, so a client that has never heard of `/deploy` still routes it
   * correctly and gets back an ephemeral answer either way.
   */
  command: (input: {
    channelId: string;
    text: string;
    clientMsgId: string;
  }) => post<CommandResult>("/api/commands", input),
  edit: (id: string, body: string) =>
    patch<{ message: Message }>(`/api/messages/${id}`, { body }),
  remove: (id: string) => del<{ ok: true }>(`/api/messages/${id}`),
  translate: (
    id: string,
    input: {
      targetLanguage?: string | null;
      forceRefresh?: boolean;
    } = {},
  ) =>
    post<{ translation: MessageTranslation }>(
      `/api/messages/${id}/translate`,
      input,
    ),
  get: (id: string) => get<{ message: Message }>(`/api/messages/${id}`),
  thread: (rootId: string) =>
    get<{ messages: Message[] }>(`/api/messages/${rootId}/thread`),
  threads: () =>
    get<{ messages: Message[]; unreadRootIds: string[] }>("/api/threads"),
  /** Whether you are following a thread, and the write that changes it. */
  threadFollowing: (rootId: string) =>
    get<{ following: boolean }>(`/api/messages/${rootId}/thread/following`),
  followThread: (rootId: string, following: boolean) =>
    put<{ following: boolean }>(`/api/messages/${rootId}/thread/following`, {
      following,
    }),
  markThreadRead: (rootId: string) =>
    post<{ ok: true }>(`/api/messages/${rootId}/thread/read`),
  pin: (id: string, pinned: boolean) =>
    put<{ message: Message }>(`/api/messages/${id}/pin`, { pinned }),
  save: (id: string, saved: boolean) =>
    put<{ ok: true }>(`/api/messages/${id}/save`, { saved }),
  react: (id: string, emoji: string) =>
    put<{ ok: true }>(`/api/messages/${id}/reactions`, { emoji }),
  unreact: (id: string, emoji: string) =>
    del<{ ok: true }>(
      `/api/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`,
    ),
  /** Choose these options in a poll, replacing your choice; none withdraws it. */
  vote: (id: string, optionIds: string[]) =>
    put<{ message: Message; mine: string[] }>(`/api/messages/${id}/poll/votes`, {
      optionIds,
    }),
  /** What you chose — the one thing an anonymous poll tells only you. */
  myVote: (id: string) => get<{ mine: string[] }>(`/api/messages/${id}/poll`),
  closePoll: (id: string) => post<{ message: Message }>(`/api/messages/${id}/poll/close`),
};
