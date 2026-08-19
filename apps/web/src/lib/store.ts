/**
 * Client state.
 *
 * Messages are kept per channel in ascending id order. Because ids are UUIDv7 they
 * sort chronologically, so inserting a live message is a sorted-position insert and
 * "is this newer than what I've read" is a string comparison — the same trick the
 * server uses for unread counts.
 */

import { create } from 'zustand';
import type {
  Bootstrap,
  ChannelWithState,
  CurrentUser,
  Message,
  PresenceState,
  ServerEvent,
  User,
  UserPrefs,
} from '@blob/shared';
import { api } from './api.ts';
import { socket, type SocketStatus } from './socket.ts';

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  /** True once we've fetched at least one page. */
  loaded: boolean;
}

interface State {
  ready: boolean;
  status: SocketStatus;
  currentUser: CurrentUser | null;
  workspaceName: string;
  users: Record<string, User>;
  channels: Record<string, ChannelWithState>;
  messages: Record<string, ChannelMessages>;
  threads: Record<string, Message[]>;
  presence: Record<string, PresenceState>;
  typing: Record<string, Record<string, number>>;
  activeChannelId: string | null;
  activeThreadRootId: string | null;
  /** Where the "New messages" divider sits, captured when a channel is opened. */
  unreadMarkers: Record<string, string | null>;

  boot: (data: Bootstrap) => void;
  reset: () => void;
  openChannel: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  openThread: (rootId: string | null) => Promise<void>;
  sendMessage: (channelId: string, body: string, threadRootId?: string | null) => Promise<void>;
  toggleReaction: (message: Message, emoji: string) => Promise<void>;
  markRead: (channelId: string) => Promise<void>;
  applyEvent: (event: ServerEvent) => void;
  resync: () => Promise<void>;
  setPrefs: (prefs: Partial<UserPrefs>) => Promise<void>;
  displayNameOf: (userId: string | null) => string;
  channelTitle: (channel: ChannelWithState) => string;
}

const emptyMessages = (): ChannelMessages => ({
  items: [],
  hasMore: true,
  loading: false,
  loaded: false,
});

/** Insert or replace a message, keeping the list sorted by id. */
function upsert(items: Message[], message: Message): Message[] {
  const existingIndex = items.findIndex(
    (m) => m.id === message.id || (m.clientMsgId && m.clientMsgId === message.clientMsgId),
  );
  if (existingIndex >= 0) {
    const next = items.slice();
    next[existingIndex] = message;
    return next;
  }
  const next = items.slice();
  let index = next.length;
  while (index > 0 && (next[index - 1] as Message).id > message.id) index -= 1;
  next.splice(index, 0, message);
  return next;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  status: 'offline',
  currentUser: null,
  workspaceName: '',
  users: {},
  channels: {},
  messages: {},
  threads: {},
  presence: {},
  typing: {},
  activeChannelId: null,
  activeThreadRootId: null,
  unreadMarkers: {},

  boot: (data) =>
    set({
      ready: true,
      currentUser: data.user,
      workspaceName: data.workspace.name,
      users: Object.fromEntries(data.users.map((u) => [u.id, u])),
      channels: Object.fromEntries(data.channels.map((c) => [c.id, c])),
    }),

  reset: () =>
    set({
      ready: false,
      currentUser: null,
      users: {},
      channels: {},
      messages: {},
      threads: {},
      presence: {},
      typing: {},
      activeChannelId: null,
      activeThreadRootId: null,
      unreadMarkers: {},
    }),

  openChannel: async (channelId) => {
    const state = get();
    set({
      activeChannelId: channelId,
      activeThreadRootId: null,
      // Freeze the unread divider where it was on entry, so it doesn't jump as
      // messages arrive while you're reading.
      unreadMarkers: {
        ...state.unreadMarkers,
        [channelId]: state.channels[channelId]?.lastReadMessageId ?? null,
      },
    });
    socket.send({ t: 'channel.focus', channelId });

    if (!state.messages[channelId]?.loaded) {
      set((s) => ({
        messages: { ...s.messages, [channelId]: { ...emptyMessages(), loading: true } },
      }));
      const { messages, hasMore } = await api.messages.history(channelId, { limit: 50 });
      set((s) => ({
        messages: { ...s.messages, [channelId]: { items: messages, hasMore, loading: false, loaded: true } },
      }));
    }
    await get().markRead(channelId);
  },

  loadOlder: async (channelId) => {
    const current = get().messages[channelId];
    if (!current || current.loading || !current.hasMore || current.items.length === 0) return;

    set((s) => ({
      messages: { ...s.messages, [channelId]: { ...current, loading: true } },
    }));
    const oldest = current.items[0] as Message;
    const { messages, hasMore } = await api.messages.history(channelId, {
      before: oldest.id,
      limit: 50,
    });
    set((s) => {
      const existing = s.messages[channelId] ?? emptyMessages();
      return {
        messages: {
          ...s.messages,
          [channelId]: {
            items: [...messages, ...existing.items],
            hasMore,
            loading: false,
            loaded: true,
          },
        },
      };
    });
  },

  openThread: async (rootId) => {
    set({ activeThreadRootId: rootId });
    if (!rootId) return;
    const { messages } = await api.messages.thread(rootId);
    set((s) => ({ threads: { ...s.threads, [rootId]: messages } }));
  },

  sendMessage: async (channelId, body, threadRootId = null) => {
    const user = get().currentUser;
    if (!user) return;

    const clientMsgId = crypto.randomUUID();
    const optimistic: Message = {
      id: `pending-${clientMsgId}`,
      channelId,
      authorId: user.id,
      kind: 'user',
      body,
      threadRootId,
      alsoInChannel: false,
      replyCount: 0,
      replyUserIds: [],
      lastReplyAt: null,
      mentionUserIds: [],
      mentionsEveryone: false,
      clientMsgId,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      attachments: [],
      linkPreview: null,
    };

    // Show it immediately; the server's copy replaces it by clientMsgId.
    if (threadRootId) {
      set((s) => ({
        threads: { ...s.threads, [threadRootId]: [...(s.threads[threadRootId] ?? []), optimistic] },
      }));
    } else {
      set((s) => {
        const existing = s.messages[channelId] ?? emptyMessages();
        return {
          messages: {
            ...s.messages,
            [channelId]: { ...existing, items: [...existing.items, optimistic], loaded: true },
          },
        };
      });
    }

    try {
      const { message } = await api.messages.send(channelId, {
        body,
        clientMsgId,
        threadRootId,
      });
      get().applyEvent({ t: 'message.new', message });
    } catch (err) {
      // Leave the bubble in place but mark it failed, so the text isn't lost.
      const failed = { ...optimistic, body: optimistic.body, kind: 'user' as const };
      set((s) => {
        const existing = s.messages[channelId] ?? emptyMessages();
        return {
          messages: {
            ...s.messages,
            [channelId]: {
              ...existing,
              items: existing.items.map((m) => (m.clientMsgId === clientMsgId ? failed : m)),
            },
          },
        };
      });
      throw err;
    }
  },

  toggleReaction: async (message, emoji) => {
    const user = get().currentUser;
    if (!user) return;
    const mine = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(user.id);
    if (mine) {
      await api.messages.unreact(message.id, emoji);
    } else {
      await api.messages.react(message.id, emoji);
    }
  },

  markRead: async (channelId) => {
    const list = get().messages[channelId];
    const newest = list?.items.filter((m) => !m.id.startsWith('pending-')).at(-1);
    if (!newest) return;
    const channel = get().channels[channelId];
    if (channel && channel.lastReadMessageId === newest.id && channel.mentionCount === 0) return;

    await api.channels.markRead(channelId, newest.id);
  },

  applyEvent: (event) => {
    switch (event.t) {
      case 'message.new':
      case 'message.updated': {
        const message = event.message;
        set((s) => {
          const next: Partial<State> = {};

          if (message.threadRootId) {
            const thread = s.threads[message.threadRootId];
            if (thread) {
              next.threads = { ...s.threads, [message.threadRootId]: upsert(thread, message) };
            }
          } else {
            const existing = s.messages[message.channelId];
            // Only fold into a channel we've actually loaded; otherwise the first
            // page fetch would show a gap between this message and the older ones.
            if (existing?.loaded) {
              next.messages = {
                ...s.messages,
                [message.channelId]: { ...existing, items: upsert(existing.items, message) },
              };
            }
          }

          const channel = s.channels[message.channelId];
          if (channel && event.t === 'message.new') {
            const isMine = message.authorId === s.currentUser?.id;
            const isActive = s.activeChannelId === message.channelId;
            next.channels = {
              ...s.channels,
              [message.channelId]: {
                ...channel,
                lastMessageId: message.id,
                hasUnread: !isMine && !isActive,
              },
            };
          }
          return next;
        });

        // Reading a channel you're looking at should clear its unread immediately.
        if (event.t === 'message.new' && get().activeChannelId === message.channelId) {
          void get().markRead(message.channelId);
        }
        break;
      }

      case 'message.deleted': {
        set((s) => {
          const existing = s.messages[event.channelId];
          const next: Partial<State> = {};
          if (existing) {
            next.messages = {
              ...s.messages,
              [event.channelId]: {
                ...existing,
                items: existing.items.filter((m) => m.id !== event.id),
              },
            };
          }
          if (event.threadRootId && s.threads[event.threadRootId]) {
            next.threads = {
              ...s.threads,
              [event.threadRootId]: (s.threads[event.threadRootId] ?? []).filter(
                (m) => m.id !== event.id,
              ),
            };
          }
          return next;
        });
        break;
      }

      case 'reaction.added':
      case 'reaction.removed': {
        const adding = event.t === 'reaction.added';
        const apply = (message: Message): Message => {
          if (message.id !== event.messageId) return message;
          const reactions = message.reactions.slice();
          const index = reactions.findIndex((r) => r.emoji === event.emoji);
          if (adding) {
            if (index === -1) {
              reactions.push({ emoji: event.emoji, userIds: [event.userId] });
            } else {
              const existing = reactions[index] as { emoji: string; userIds: string[] };
              if (!existing.userIds.includes(event.userId)) {
                reactions[index] = {
                  emoji: existing.emoji,
                  userIds: [...existing.userIds, event.userId],
                };
              }
            }
          } else if (index >= 0) {
            const existing = reactions[index] as { emoji: string; userIds: string[] };
            const userIds = existing.userIds.filter((id) => id !== event.userId);
            if (userIds.length === 0) reactions.splice(index, 1);
            else reactions[index] = { emoji: existing.emoji, userIds };
          }
          return { ...message, reactions };
        };

        set((s) => ({
          messages: mapChannel(s.messages, event.channelId, apply),
          threads: Object.fromEntries(
            Object.entries(s.threads).map(([id, items]) => [id, items.map(apply)]),
          ),
        }));
        break;
      }

      case 'thread.updated': {
        const apply = (message: Message): Message =>
          message.id === event.rootId
            ? {
                ...message,
                replyCount: event.replyCount,
                replyUserIds: event.replyUserIds,
                lastReplyAt: event.lastReplyAt,
              }
            : message;
        set((s) => ({ messages: mapChannel(s.messages, event.channelId, apply) }));
        break;
      }

      case 'channel.created':
      case 'channel.updated':
        set((s) => ({ channels: { ...s.channels, [event.channel.id]: event.channel } }));
        break;

      case 'channel.archived':
        set((s) => {
          const channel = s.channels[event.channelId];
          if (!channel) return {};
          return {
            channels: {
              ...s.channels,
              [event.channelId]: { ...channel, archivedAt: new Date().toISOString() },
            },
          };
        });
        break;

      case 'read_state.updated':
        set((s) => {
          const channel = s.channels[event.channelId];
          if (!channel) return {};
          return {
            channels: {
              ...s.channels,
              [event.channelId]: {
                ...channel,
                lastReadMessageId: event.lastReadMessageId,
                mentionCount: event.mentionCount,
                hasUnread: Boolean(
                  channel.lastMessageId &&
                    (!event.lastReadMessageId || channel.lastMessageId > event.lastReadMessageId),
                ),
              },
            },
          };
        });
        break;

      case 'presence':
        set((s) => ({ presence: { ...s.presence, [event.userId]: event.state } }));
        break;

      case 'typing':
        set((s) => ({
          typing: {
            ...s.typing,
            [event.channelId]: { ...(s.typing[event.channelId] ?? {}), [event.userId]: Date.now() },
          },
        }));
        break;

      case 'user.updated':
        set((s) => ({ users: { ...s.users, [event.user.id]: event.user } }));
        break;

      case 'member.joined':
      case 'member.left':
      case 'hello':
      case 'pong':
      case 'error':
        break;
    }
  },

  /** After a reconnect, ask the server what we missed rather than assume nothing. */
  resync: async () => {
    const state = get();
    const cursors: Record<string, string> = {};
    for (const [channelId, list] of Object.entries(state.messages)) {
      const newest = list.items.filter((m) => !m.id.startsWith('pending-')).at(-1);
      if (newest) cursors[channelId] = newest.id;
    }

    const result = await api.sync(cursors);

    set((s) => ({
      channels: Object.fromEntries(result.channels.map((c) => [c.id, c])),
      // Channels whose gap was too large get dropped and refetched on next open.
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(([id]) => !result.resyncChannelIds.includes(id)),
      ),
    }));

    for (const message of result.messages) {
      get().applyEvent({ t: 'message.new', message });
    }

    const active = get().activeChannelId;
    if (active && !get().messages[active]?.loaded) await get().openChannel(active);
  },

  setPrefs: async (prefs) => {
    const { prefs: updated } = await api.me.prefs(prefs);
    set((s) => (s.currentUser ? { currentUser: { ...s.currentUser, prefs: updated } } : {}));
  },

  displayNameOf: (userId) => {
    if (!userId) return 'Unknown';
    return get().users[userId]?.displayName ?? 'Someone';
  },

  channelTitle: (channel) => {
    if (channel.name) return `#${channel.name}`;
    const me = get().currentUser?.id;
    const others = (channel.memberIds ?? []).filter((id) => id !== me);
    if (others.length === 0) return 'You';
    return others.map((id) => get().displayNameOf(id)).join(', ');
  },
}));

function mapChannel(
  messages: Record<string, ChannelMessages>,
  channelId: string,
  fn: (message: Message) => Message,
): Record<string, ChannelMessages> {
  const existing = messages[channelId];
  if (!existing) return messages;
  return { ...messages, [channelId]: { ...existing, items: existing.items.map(fn) } };
}

/** Wire the socket into the store once, at app start. */
export function connectStoreToSocket(): () => void {
  const unsubscribeEvents = socket.subscribe((event) => useStore.getState().applyEvent(event));
  const unsubscribeStatus = socket.onStatus((status) => useStore.setState({ status }));
  socket.onReconnect = () => {
    void useStore.getState().resync();
  };
  socket.connect();

  return () => {
    unsubscribeEvents();
    unsubscribeStatus();
    socket.onReconnect = null;
    socket.disconnect();
  };
}
