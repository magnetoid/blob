/**
 * Client state.
 *
 * Messages are kept per channel in ascending id order. Because ids are UUIDv7 they
 * sort chronologically, so inserting a live message is a sorted-position insert and
 * "is this newer than what I've read" is a string comparison — the same trick the
 * server uses for unread counts.
 */

import { create, type StateCreator } from "zustand";
import type {
  AgentRunView,
  Bootstrap,
  ChannelWithState,
  CommandSpec,
  CurrentUser,
  CustomEmoji,
  Message,
  PresenceState,
  ServerEvent,
  Theme,
  User,
  UserGroup,
  UserPrefs,
} from "@blob/shared";
import { api } from "./api.ts";
import { showError, useToasts } from "./toasts.ts";
import {
  draftKey,
  flushDrafts,
  loadDrafts,
  persistDrafts,
  schedulePersist,
  withDraft,
  type Drafts,
} from "./drafts.ts";
import {
  isRecoverableSendError,
  loadOutbox,
  materializeOutboxMessage,
  persistOutbox,
  sortOutbox,
  type LocalMessageDeliveryStatus,
  type LocalOutboxEntry,
} from "./outbox.ts";
import { socket, type SocketStatus } from "./socket.ts";

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  /** True once we've fetched at least one page. */
  loaded: boolean;
  /** The last fetch failed; the view offers a retry instead of "start of #channel". */
  error?: boolean;
}

interface State {
  ready: boolean;
  status: SocketStatus;
  currentUser: CurrentUser | null;
  workspaceName: string;
  themes: Theme[];
  /** The workspace's own emoji, for the picker and for `:name:` in a body. */
  customEmoji: CustomEmoji[];
  /** Message ids you have put aside. A Set: the message menu asks per row. */
  savedMessageIds: Set<string>;
  /** Every group here, by id — a message can name one you are not in. */
  groups: Record<string, UserGroup>;
  /** The groups you are in, so a group mention can count as mentioning you. */
  myGroupIds: Set<string>;
  /** The groups you silenced; the notifications screen renders the switch from this. */
  mutedGroupIds: Set<string>;
  /** Slash commands this server knows, for the composer's autocomplete. */
  commands: CommandSpec[];
  /**
   * The commit the server is running, when its host said which.
   *
   * The bundle stamps its own at build time; this is what answers when the build could
   * not read a repository, which is what happens on a host that deploys a source tree.
   * "What's new" prefers the build's own answer and falls back to this.
   */
  serverCommit: string | null;
  users: Record<string, User>;
  channels: Record<string, ChannelWithState>;
  messages: Record<string, ChannelMessages>;
  threads: Record<string, Message[]>;
  outbox: Record<string, LocalOutboxEntry>;
  /** Typed and unsent, keyed by `draftKey` — a channel, or a thread inside one. */
  drafts: Drafts;
  /**
   * The message currently open for editing, if any.
   *
   * In the store rather than in `MessageRow` because ↑ from an empty composer has to
   * open one, and the composer cannot reach into a sibling's local state. At most one
   * message is editable at a time, which a single id says and a boolean per row does not.
   */
  editingMessageId: string | null;
  /**
   * A message to bring into view once the list that holds it has rendered.
   *
   * Here rather than in `navigation.ts` because the list is virtualized: only the
   * visible rows are in the DOM, so a jump cannot be done by finding the element and
   * scrolling to it — the element does not exist yet, and it will not exist until
   * something has scrolled. Only `MessageList` holds the virtualizer that can put a row
   * on screen by index, and it cannot be handed a callback by a module the router
   * calls. So the target is left here and the list picks it up.
   */
  pendingScrollMessageId: string | null;
  presence: Record<string, PresenceState>;
  typing: Record<string, Record<string, number>>;
  activeChannelId: string | null;
  activeThreadRootId: string | null;
  /** Where the "New messages" divider sits, captured when a channel is opened. */
  unreadMarkers: Record<string, string | null>;
  /** Bumped on member.joined/left so member-list caches know to refetch. */
  membershipVersion: Record<string, number>;
  /** Which Catch Me Up is open — one channel, everything, or neither. Lives in the
   * store so the palette (rendered anywhere) can open a panel the shell renders. */
  catchupScope: "channel" | "all" | null;
  /** The agent whose terminal is open in the right-hand panel, or null.
   *  Same reason as `catchupScope`: `/cli` is handled in the composer, and the panel
   *  that answers it is rendered by the shell. */
  terminalTarget: { pluginId: string; agentName: string } | null;
  /** Live and recent agent runs, keyed by run id. Fed by socket events and the
   * per-channel fetch on open; the card under a trigger message renders from this. */
  agentRuns: Record<string, AgentRunView>;
  /**
   * A channel where you deliberately left something unread.
   *
   * Auto-read is aggressive by design — `openChannel` marks read on arrival and every
   * `message.new` in the channel you are looking at marks read again — so without this,
   * one arriving message would undo the thing you just asked for. Cleared on the next
   * channel you open, so coming back reads normally.
   */
  suppressReadFor: string | null;

  boot: (data: Bootstrap) => void;
  reset: () => void;
  hydrateOutbox: () => void;
  flushOutbox: () => Promise<void>;
  hydrateDrafts: () => void;
  setDraft: (
    channelId: string,
    threadRootId: string | null,
    body: string,
  ) => void;
  setEditingMessage: (messageId: string | null) => void;
  /** Ask the list to bring a message into view; it clears this once it has. */
  requestScrollToMessage: (messageId: string | null) => void;
  /** Open your most recent message here for editing. Returns whether there was one. */
  editLastMessage: (channelId: string, threadRootId: string | null) => boolean;
  /**
   * Open a channel. With `around`, load the page containing that message instead of the
   * newest one — what a permalink to something months old needs.
   */
  openChannel: (channelId: string, around?: string) => Promise<void>;
  leaveChannel: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  openThread: (rootId: string | null) => Promise<void>;
  sendMessage: (
    channelId: string,
    body: string,
    threadRootId?: string | null,
    attachmentIds?: string[],
    alsoInChannel?: boolean,
  ) => Promise<void>;
  retryQueuedMessage: (clientMsgId: string) => Promise<void>;
  discardQueuedMessage: (clientMsgId: string) => void;
  messageDeliveryState: (message: Message) => LocalMessageDeliveryStatus | null;
  toggleReaction: (message: Message, emoji: string) => Promise<void>;
  toggleSaved: (messageId: string) => Promise<void>;
  markRead: (channelId: string) => Promise<void>;
  /** Leave a message, and everything after it, unread. */
  markUnread: (channelId: string, messageId: string) => Promise<void>;
  /** Slack's Shift+Esc: every channel's cursor to its newest message. */
  markAllRead: () => Promise<void>;
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
  error: false,
});

let resyncRetryTimer: ReturnType<typeof setTimeout> | null = null;

/** One pending retry at a time, however many resyncs failed. */
function scheduleResyncRetry(run: () => void): void {
  if (resyncRetryTimer) return;
  resyncRetryTimer = setTimeout(() => {
    resyncRetryTimer = null;
    run();
  }, 5000);
}

/**
 * One sorted list from two.
 *
 * Where a fetched page meets messages that arrived while it was being fetched. Built on
 * `upsert` so the ordering rule lives in one place — ids are UUIDv7, so "sorted by id"
 * is "sorted by time".
 */
function mergeById(page: Message[], arrived: Message[]): Message[] {
  let merged = page;
  for (const message of arrived) merged = upsert(merged, message);
  return merged;
}

/** Insert or replace a message, keeping the list sorted by id. */
function upsert(items: Message[], message: Message): Message[] {
  const existingIndex = items.findIndex(
    (m) =>
      m.id === message.id ||
      (m.clientMsgId && m.clientMsgId === message.clientMsgId),
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

/**
 * Whether a message belongs in its channel's own list.
 *
 * Thread replies live in the thread. The exception is the one whose author ticked "Also
 * send to #channel", which is deliberately in both — `services/messages.IN_CHANNEL_HISTORY`
 * is the server half of this same sentence.
 */
function inChannelHistory(message: Message): boolean {
  return !message.threadRootId || message.alsoInChannel;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  status: "offline",
  currentUser: null,
  workspaceName: "",
  themes: [],
  customEmoji: [],
  savedMessageIds: new Set<string>(),
  groups: {},
  myGroupIds: new Set<string>(),
  mutedGroupIds: new Set<string>(),
  serverCommit: null,
  commands: [],
  users: {},
  channels: {},
  messages: {},
  threads: {},
  outbox: {},
  drafts: {},
  editingMessageId: null,
  pendingScrollMessageId: null,
  presence: {},
  typing: {},
  activeChannelId: null,
  activeThreadRootId: null,
  unreadMarkers: {},
  membershipVersion: {},
  agentRuns: {},
  catchupScope: null,
  terminalTarget: null,
  suppressReadFor: null,

  boot: (data) =>
    set({
      ready: true,
      currentUser: data.user,
      workspaceName: data.workspace.name,
      themes: data.themes,
      customEmoji: data.customEmoji,
      savedMessageIds: new Set(data.savedMessageIds),
      groups: Object.fromEntries(data.groups.map((g) => [g.id, g])),
      myGroupIds: new Set(data.myGroupIds),
      mutedGroupIds: new Set(data.mutedGroupIds),
      commands: data.commands,
      serverCommit: data.serverCommit ?? null,
      users: Object.fromEntries(data.users.map((u) => [u.id, u])),
      channels: Object.fromEntries(data.channels.map((c) => [c.id, c])),
    }),

  reset: () => {
    persistOutbox({});
    // Signing out clears drafts, as it clears the outbox. Half-written text is the kind
    // of thing you would not want left on a machine you have just handed back. Flushed
    // first, or a write scheduled a moment ago lands after the wipe and restores them.
    flushDrafts();
    persistDrafts({});
    set({
      ready: false,
      workspaceName: "",
      themes: [],
      customEmoji: [],
      savedMessageIds: new Set<string>(),
      groups: {},
      myGroupIds: new Set<string>(),
      commands: [],
      currentUser: null,
      users: {},
      channels: {},
      messages: {},
      threads: {},
      outbox: {},
      drafts: {},
      editingMessageId: null,
      presence: {},
      typing: {},
      activeChannelId: null,
      activeThreadRootId: null,
      unreadMarkers: {},
      suppressReadFor: null,
    });
  },

  hydrateOutbox: () => {
    const restored = sortOutbox(loadOutbox()).reduce<
      Record<string, LocalOutboxEntry>
    >((acc, entry) => {
      acc[entry.clientMsgId] = {
        ...entry,
        status: entry.status === "failed" ? "failed" : "queued",
      };
      return acc;
    }, {});
    persistOutbox(restored);
    set((s) => withProjectedOutbox(s, restored));
    if (get().status === "online") {
      void get().flushOutbox();
    }
  },

  hydrateDrafts: () => {
    const restored = loadDrafts();
    // Written back because loading prunes: what expired or did not fit should leave
    // storage now, not the next time somebody happens to type.
    persistDrafts(restored);
    set({ drafts: restored });
  },

  setDraft: (channelId, threadRootId, body) => {
    const key = draftKey(channelId, threadRootId);
    const next = withDraft(get().drafts, key, body);
    // Unchanged means unchanged: `withDraft` returns the same object when the body has
    // not moved, and re-setting it would re-render every subscriber on each keystroke
    // that lands back on the same text.
    if (next === get().drafts) return;
    // Scheduled, not written: this runs per keystroke, and the durable copy can lag the
    // one on screen by a moment. `flushDrafts` closes the gap when the tab goes away.
    schedulePersist(next);
    set({ drafts: next });
  },

  setEditingMessage: (messageId) => set({ editingMessageId: messageId }),

  requestScrollToMessage: (messageId) =>
    set({ pendingScrollMessageId: messageId }),

  editLastMessage: (channelId, threadRootId) => {
    const state = get();
    const me = state.currentUser?.id;
    if (!me) return false;

    const items = threadRootId
      ? (state.threads[threadRootId] ?? [])
      : (state.messages[channelId]?.items ?? []);

    // Backwards from the end, and skipping what cannot be edited: a deleted message, and
    // anything still in the outbox — a pending row has no server id to send an edit for.
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const message = items[i];
      if (!message) continue;
      if (message.authorId !== me) continue;
      if (message.deletedAt) continue;
      if (message.id.startsWith("pending-")) continue;
      set({ editingMessageId: message.id });
      return true;
    }
    return false;
  },

  flushOutbox: async () => {
    if (!get().currentUser || get().status !== "online") return;

    for (const entry of sortOutbox(get().outbox)) {
      const latest = get().outbox[entry.clientMsgId];
      if (!latest) continue;

      setOutbox(set, get, (outbox) => ({
        ...outbox,
        [latest.clientMsgId]: {
          ...latest,
          status: "sending",
          attempts: latest.attempts + 1,
          lastError: null,
        },
      }));

      try {
        const { message } = await api.messages.send(latest.channelId, {
          body: latest.body,
          clientMsgId: latest.clientMsgId,
          threadRootId: latest.threadRootId,
          attachmentIds: latest.attachmentIds,
        });
        setOutbox(set, get, (outbox) => {
          const next = { ...outbox };
          delete next[latest.clientMsgId];
          return next;
        });
        get().applyEvent({ t: "message.new", message });
      } catch (error) {
        if (isRecoverableSendError(error)) {
          setOutbox(set, get, (outbox) => ({
            ...outbox,
            [latest.clientMsgId]: {
              ...(outbox[latest.clientMsgId] as LocalOutboxEntry),
              status: "queued",
              lastError: "Waiting for a stable connection.",
            },
          }));
          break;
        }

        const message =
          error instanceof Error
            ? error.message
            : "That message could not be delivered.";
        setOutbox(set, get, (outbox) => ({
          ...outbox,
          [latest.clientMsgId]: {
            ...(outbox[latest.clientMsgId] as LocalOutboxEntry),
            status: "failed",
            lastError: message,
          },
        }));
      }
    }
  },

  openChannel: async (channelId, around) => {
    const state = get();
    set({
      activeChannelId: channelId,
      // Cleared on every open, including of the same channel: coming back to something
      // you left unread is exactly when it should be read again.
      suppressReadFor: null,
      activeThreadRootId: null,
      // Freeze the unread divider where it was on entry, so it doesn't jump as
      // messages arrive while you're reading.
      unreadMarkers: {
        ...state.unreadMarkers,
        [channelId]: state.channels[channelId]?.lastReadMessageId ?? null,
      },
    });

    // Live and recent runs, so a reload or a mid-run join renders the same card the
    // stream drew. Non-fatal: a conversation without its run cards is still a
    // conversation.
    void api.agentRuns
      .forChannel(channelId)
      .then(({ runs }) =>
        set((s) => ({
          agentRuns: {
            ...s.agentRuns,
            ...Object.fromEntries(runs.map((run) => [run.id, run])),
          },
        })),
      )
      .catch(() => undefined);

    // A permalink names a specific message, which is very often not on the newest page.
    // This has to run even when the channel is already loaded — that is the ordinary
    // case, following a link to a channel you are sitting in — so it cannot hide behind
    // the `loaded` check the way the first page does.
    if (around) {
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: {
            ...(s.messages[channelId] ?? emptyMessages()),
            loading: true,
            error: false,
          },
        },
      }));
      let messages: Message[];
      try {
        ({ messages } = await api.messages.history(channelId, {
          around,
          limit: 50,
        }));
      } catch (err) {
        showError(err);
        set((s) => ({
          messages: {
            ...s.messages,
            [channelId]: {
              ...(s.messages[channelId] ?? emptyMessages()),
              loading: false,
              error: true,
            },
          },
        }));
        return;
      }
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: {
            items: overlayChannelOutbox(
              s.currentUser,
              s.outbox,
              channelId,
              // Replaced, not merged, unlike the first-page load below. This window is
              // deliberately not anchored to the tail, so folding in a message that
              // arrived meanwhile would put it directly after one hundreds older.
              messages,
            ),
            // Both ends are truncated by an `around` fetch, so there is always more in
            // at least one direction. Claiming otherwise would disable paging back.
            hasMore: true,
            loading: false,
            loaded: true,
            error: false,
          },
        },
      }));
      // Deliberately no markRead: arriving at an old message must not mark everything
      // after it as read. The divider stays where entering the channel put it.
      return;
    }

    if (!state.messages[channelId]?.loaded) {
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: { ...emptyMessages(), loading: true },
        },
      }));
      let messages: Message[];
      let hasMore: boolean;
      try {
        ({ messages, hasMore } = await api.messages.history(channelId, {
          limit: 50,
        }));
      } catch (err) {
        // Without this, `loading` stuck at true forever and the empty state claimed
        // "This is the start of #channel" about a channel full of history.
        showError(err);
        set((s) => ({
          messages: {
            ...s.messages,
            [channelId]: { ...emptyMessages(), loading: false, error: true },
          },
        }));
        return;
      }
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: {
            items: overlayChannelOutbox(
              s.currentUser,
              s.outbox,
              channelId,
              // Merged, not replaced. A message delivered over the socket while this
              // request was in flight is newer than anything the response can hold, and
              // replacing threw it away for good — nothing refetches a channel that is
              // `loaded`, so it stayed missing until the page was reloaded.
              mergeById(
                messages,
                stripPending(s.messages[channelId]?.items ?? []),
              ),
            ),
            hasMore,
            loading: false,
            loaded: true,
            error: false,
          },
        },
      }));
    }
    await get().markRead(channelId);
  },

  /**
   * Leave a channel, and stop showing it as one you are in.
   *
   * The server unsubscribes the socket and broadcasts `member.left`, but that event is
   * about somebody leaving *a* channel and carries no view of it — and our own copy
   * still has `membership` set, so without this the channel would sit in the sidebar
   * looking joined until the next reload.
   *
   * A public channel keeps its row and moves to the browsable list, because it is still
   * there to be rejoined. A private one is dropped entirely: `assert_channel_access`
   * refuses it from now on, so keeping it on screen would offer a door that answers 404.
   */
  leaveChannel: async (channelId) => {
    await api.channels.leave(channelId);
    set((s) => {
      const channel = s.channels[channelId];
      if (!channel) return {};
      const channels = { ...s.channels };
      if (channel.kind === "private") delete channels[channelId];
      else channels[channelId] = { ...channel, membership: null };
      return {
        channels,
        activeChannelId:
          s.activeChannelId === channelId ? null : s.activeChannelId,
        activeThreadRootId:
          s.activeChannelId === channelId ? null : s.activeThreadRootId,
      };
    });
  },

  loadOlder: async (channelId) => {
    const current = get().messages[channelId];
    if (
      !current ||
      current.loading ||
      !current.hasMore ||
      current.items.length === 0
    )
      return;

    set((s) => ({
      messages: { ...s.messages, [channelId]: { ...current, loading: true } },
    }));
    const oldest = current.items[0] as Message;
    let messages: Message[];
    let hasMore: boolean;
    try {
      ({ messages, hasMore } = await api.messages.history(channelId, {
        before: oldest.id,
        limit: 50,
      }));
    } catch (err) {
      // The same guard `openChannel` above already has, and for the same reason its
      // comment gives: without it `loading` stays true for ever. Here that is worse
      // than a stuck flag, because the flag is the button — one blocked fetch left
      // "Load earlier messages" reading "Loading…" and disabled, so a single network
      // blip cost the reader every message above the fold until they reloaded the page.
      //
      // The loaded messages are kept and only the flag is cleared: there is nothing
      // wrong with what is already on screen, and `hasMore` must not be turned off,
      // which would claim the conversation starts here.
      showError(err);
      set((s) => {
        const existing = s.messages[channelId];
        if (!existing) return {};
        return {
          messages: {
            ...s.messages,
            [channelId]: { ...existing, loading: false },
          },
        };
      });
      return;
    }
    set((s) => {
      const existing = s.messages[channelId] ?? emptyMessages();
      return {
        messages: {
          ...s.messages,
          [channelId]: {
            items: overlayChannelOutbox(s.currentUser, s.outbox, channelId, [
              ...messages,
              ...stripPending(existing.items),
            ]),
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
    let messages: Message[];
    try {
      ({ messages } = await api.messages.thread(rootId));
    } catch (err) {
      // Close the panel rather than leave it open and blank: an empty panel with no
      // words is indistinguishable from a thread with no replies.
      showError(err);
      set({ activeThreadRootId: null });
      return;
    }
    set((s) => ({
      threads: {
        ...s.threads,
        [rootId]: overlayThreadOutbox(
          s.currentUser,
          s.outbox,
          rootId,
          messages,
        ),
      },
    }));
  },

  sendMessage: async (
    channelId,
    body,
    threadRootId = null,
    attachmentIds = [],
    alsoInChannel = false,
  ) => {
    const user = get().currentUser;
    if (!user) return;

    const clientMsgId = crypto.randomUUID();
    const optimisticEntry: LocalOutboxEntry = {
      clientMsgId,
      channelId,
      threadRootId,
      body,
      attachmentIds,
      createdAt: new Date().toISOString(),
      status: get().status === "online" ? "sending" : "queued",
      attempts: 0,
      lastError: null,
    };

    setOutbox(set, get, (outbox) => ({
      ...outbox,
      [clientMsgId]: optimisticEntry,
    }));

    if (optimisticEntry.status === "queued") return;

    try {
      const { message } = await api.messages.send(channelId, {
        body,
        clientMsgId,
        threadRootId,
        attachmentIds,
        alsoInChannel: alsoInChannel && threadRootId !== null,
      });
      setOutbox(set, get, (outbox) => {
        const next = { ...outbox };
        delete next[clientMsgId];
        return next;
      });
      get().applyEvent({ t: "message.new", message });
    } catch (error) {
      if (isRecoverableSendError(error)) {
        setOutbox(set, get, (outbox) => ({
          ...outbox,
          [clientMsgId]: {
            ...(outbox[clientMsgId] as LocalOutboxEntry),
            status: "queued",
            attempts: (outbox[clientMsgId] as LocalOutboxEntry).attempts + 1,
            lastError: "Waiting for a stable connection.",
          },
        }));
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "That message could not be delivered.";
      setOutbox(set, get, (outbox) => ({
        ...outbox,
        [clientMsgId]: {
          ...(outbox[clientMsgId] as LocalOutboxEntry),
          status: "failed",
          attempts: (outbox[clientMsgId] as LocalOutboxEntry).attempts + 1,
          lastError: message,
        },
      }));
      throw error;
    }
  },

  retryQueuedMessage: async (clientMsgId) => {
    const current = get().outbox[clientMsgId];
    if (!current) return;
    setOutbox(set, get, (outbox) => ({
      ...outbox,
      [clientMsgId]: { ...current, status: "queued", lastError: null },
    }));
    await get().flushOutbox();
  },

  discardQueuedMessage: (clientMsgId) => {
    setOutbox(set, get, (outbox) => {
      const next = { ...outbox };
      delete next[clientMsgId];
      return next;
    });
  },

  messageDeliveryState: (message) => {
    if (!message.clientMsgId) return null;
    return get().outbox[message.clientMsgId]?.status ?? null;
  },

  toggleReaction: async (message, emoji) => {
    const user = get().currentUser;
    if (!user) return;
    const mine = message.reactions
      .find((r) => r.emoji === emoji)
      ?.userIds.includes(user.id);
    if (mine) {
      await api.messages.unreact(message.id, emoji);
    } else {
      await api.messages.react(message.id, emoji);
    }
  },

  /**
   * Put a message aside, or take it back off the list.
   *
   * Optimistic, and unlike a reaction it has to be: nothing is broadcast, so there is no
   * event to correct the row afterwards — the set in this store *is* what the menu
   * reads. Rolled back on failure rather than left hopeful, or the label would claim a
   * message is saved when the server never heard about it.
   */
  toggleSaved: async (messageId) => {
    const saved = !get().savedMessageIds.has(messageId);
    const optimistic = new Set(get().savedMessageIds);
    if (saved) optimistic.add(messageId);
    else optimistic.delete(messageId);
    set({ savedMessageIds: optimistic });

    try {
      await api.messages.save(messageId, saved);
    } catch (error) {
      set((s) => {
        const reverted = new Set(s.savedMessageIds);
        if (saved) reverted.delete(messageId);
        else reverted.add(messageId);
        return { savedMessageIds: reverted };
      });
      throw error;
    }
  },

  markRead: async (channelId) => {
    // Somebody asked for this channel to stay unread. Honoured until they open another.
    if (get().suppressReadFor === channelId) return;
    const list = get().messages[channelId];
    const newest = list?.items
      .filter((m) => !m.id.startsWith("pending-"))
      .at(-1);
    if (!newest) return;
    const channel = get().channels[channelId];
    if (
      channel &&
      channel.lastReadMessageId === newest.id &&
      channel.mentionCount === 0
    )
      return;

    await api.channels.markRead(channelId, newest.id);
  },

  markAllRead: async () => {
    const { readStates } = await api.channels.markAllRead();
    set((s) => {
      const channels = { ...s.channels };
      for (const state of readStates) {
        const channel = channels[state.channelId];
        if (!channel) continue;
        channels[state.channelId] = {
          ...channel,
          lastReadMessageId: state.lastReadMessageId,
          mentionCount: state.mentionCount,
        };
      }
      return {
        channels,
        // A channel someone asked to keep unread is not exempt — they just asked for
        // the opposite of this, and this is the more recent and more explicit request.
        suppressReadFor: null,
        // The dividers go with the cursors. Leaving them would show "New messages"
        // above a channel that just said it had none.
        unreadMarkers: {},
      };
    });
  },

  markUnread: async (channelId, messageId) => {
    const { readState } = await api.channels.markUnread(channelId, messageId);
    set((s) => ({
      // The divider moves with the cursor, so the message you marked is the first thing
      // under "New messages" rather than the app simply forgetting where you were.
      unreadMarkers: {
        ...s.unreadMarkers,
        [channelId]: readState.lastReadMessageId,
      },
      suppressReadFor: channelId,
    }));
  },

  applyEvent: (event) => {
    switch (event.t) {
      case "message.new":
      case "message.updated": {
        const message = event.message;
        // Read before the update, because the update makes both ends equal: the new
        // message becomes the last loaded item *and* the channel's lastMessageId.
        const before = get().messages[message.channelId];
        const atTailBefore =
          before?.items.filter((m) => !m.id.startsWith("pending-")).at(-1)
            ?.id === get().channels[message.channelId]?.lastMessageId;
        set((s) => {
          const next: Partial<State> = {};

          if (message.threadRootId) {
            const thread = s.threads[message.threadRootId];
            if (thread) {
              next.threads = {
                ...s.threads,
                [message.threadRootId]: overlayThreadOutbox(
                  s.currentUser,
                  s.outbox,
                  message.threadRootId,
                  upsert(stripPending(thread), message),
                ),
              };
            }
          }

          // A reply goes into the thread and stops there — unless its author ticked
          // "Also send to #channel", which is the one case a threaded message belongs in
          // both. Routing every reply into the thread alone is what made that tick a
          // no-op on the client even after history started returning it.
          if (inChannelHistory(message)) {
            const existing = s.messages[message.channelId];
            // Was the loaded list ending at the channel's newest message *before* this
            // one arrived? That is the difference between extending the tail and
            // dropping a message into a window.
            //
            // Following a permalink loads ~50 messages around something old and leaves
            // `loaded` true. Without this check the next live message was appended to
            // that window — sitting directly after a message hundreds older, with the
            // gap invisible — and then `markRead` acked it, marking every unread message
            // in between as read. `openChannel` skips `markRead` for exactly this reason
            // and says so; the skip only covered the moment of arrival.
            const wasAtTail =
              existing?.items.filter((m) => !m.id.startsWith("pending-")).at(-1)
                ?.id === s.channels[message.channelId]?.lastMessageId;
            // While the first page is still in flight there is no window to be at the
            // end of, and dropping the message loses it for good: the response used to
            // replace `items` with a snapshot that predated it, and nothing refetches a
            // channel that is already `loaded`. So arrivals are kept and the response
            // merges into them.
            const canFold = existing?.loaded
              ? wasAtTail || event.t === "message.updated"
              : Boolean(existing?.loading);
            if (existing && canFold) {
              next.messages = {
                ...s.messages,
                [message.channelId]: {
                  ...existing,
                  items: overlayChannelOutbox(
                    s.currentUser,
                    s.outbox,
                    message.channelId,
                    upsert(stripPending(existing.items), message),
                  ),
                },
              };
            }
          }

          const channel = s.channels[message.channelId];
          // The same rule the server keeps: the pointer names the newest message in the
          // channel's own history, and a thread reply is not one of those unless it was
          // also sent to the channel. Advancing it for a plain reply left the pointer
          // naming a message the channel list can never contain — so "is the list at the
          // tail?" was false from then on, and every later message in that channel was
          // dropped from the open view until a reload.
          if (channel && event.t === "message.new" && inChannelHistory(message)) {
            const isMine = message.authorId === s.currentUser?.id;
            const isActive = s.activeChannelId === message.channelId;
            next.channels = {
              ...s.channels,
              [message.channelId]: {
                ...channel,
                lastMessageId: message.id,
                // `!isActive` alone cleared the dot on a channel the reader had just
                // asked to keep unread: `markRead` honours `suppressReadFor` and returns,
                // so nothing ever put the dot back, and the sidebar disagreed with the
                // server for the rest of the session.
                hasUnread:
                  !isMine &&
                  (!isActive || s.suppressReadFor === message.channelId),
              },
            };
          }
          return next;
        });

        // Reading a channel you're looking at should clear its unread immediately —
        // but only when what is on screen actually reaches the newest message. In a
        // window opened around an old permalink it does not, and acking there would
        // mark everything between the window and the tail as read.
        if (
          event.t === "message.new" &&
          get().activeChannelId === message.channelId &&
          atTailBefore
        ) {
          void get().markRead(message.channelId);
        }
        break;
      }

      case "message.deleted": {
        set((s) => {
          const existing = s.messages[event.channelId];
          const next: Partial<State> = {};
          if (existing) {
            next.messages = {
              ...s.messages,
              [event.channelId]: {
                ...existing,
                items: overlayChannelOutbox(
                  s.currentUser,
                  s.outbox,
                  event.channelId,
                  stripPending(existing.items).filter((m) => m.id !== event.id),
                ),
              },
            };
          }
          if (event.threadRootId && s.threads[event.threadRootId]) {
            next.threads = {
              ...s.threads,
              [event.threadRootId]: overlayThreadOutbox(
                s.currentUser,
                s.outbox,
                event.threadRootId,
                stripPending(s.threads[event.threadRootId] ?? []).filter(
                  (m) => m.id !== event.id,
                ),
              ),
            };
          }
          return next;
        });
        break;
      }

      case "reaction.added":
      case "reaction.removed": {
        const adding = event.t === "reaction.added";
        const apply = (message: Message): Message => {
          if (message.id !== event.messageId) return message;
          const reactions = message.reactions.slice();
          const index = reactions.findIndex((r) => r.emoji === event.emoji);
          if (adding) {
            if (index === -1) {
              reactions.push({ emoji: event.emoji, userIds: [event.userId] });
            } else {
              const existing = reactions[index] as {
                emoji: string;
                userIds: string[];
              };
              if (!existing.userIds.includes(event.userId)) {
                reactions[index] = {
                  emoji: existing.emoji,
                  userIds: [...existing.userIds, event.userId],
                };
              }
            }
          } else if (index >= 0) {
            const existing = reactions[index] as {
              emoji: string;
              userIds: string[];
            };
            const userIds = existing.userIds.filter(
              (id) => id !== event.userId,
            );
            if (userIds.length === 0) reactions.splice(index, 1);
            else reactions[index] = { emoji: existing.emoji, userIds };
          }
          return { ...message, reactions };
        };

        set((s) => ({
          messages: mapChannel(s.messages, event.channelId, apply),
          threads: Object.fromEntries(
            Object.entries(s.threads).map(([id, items]) => [
              id,
              items.map(apply),
            ]),
          ),
        }));
        break;
      }

      case "thread.updated": {
        const apply = (message: Message): Message =>
          message.id === event.rootId
            ? {
                ...message,
                replyCount: event.replyCount,
                replyUserIds: event.replyUserIds,
                lastReplyAt: event.lastReplyAt,
              }
            : message;
        set((s) => ({
          messages: mapChannel(s.messages, event.channelId, apply),
        }));
        break;
      }

      case "channel.created":
      case "channel.updated":
        set((s) => ({
          channels: { ...s.channels, [event.channel.id]: event.channel },
        }));
        break;

      case "channel.archived":
        set((s) => {
          const channel = s.channels[event.channelId];
          if (!channel) return {};
          return {
            channels: {
              ...s.channels,
              [event.channelId]: {
                ...channel,
                archivedAt: new Date().toISOString(),
              },
            },
          };
        });
        break;

      case "read_state.updated":
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
                  (!event.lastReadMessageId ||
                    channel.lastMessageId > event.lastReadMessageId),
                ),
              },
            },
          };
        });
        break;

      case "presence":
        set((s) => ({
          presence: { ...s.presence, [event.userId]: event.state },
        }));
        break;

      case "typing":
        set((s) => ({
          typing: {
            ...s.typing,
            [event.channelId]: {
              ...(s.typing[event.channelId] ?? {}),
              [event.userId]: Date.now(),
            },
          },
        }));
        break;

      case "user.updated":
        set((s) => ({
          users: { ...s.users, [event.user.id]: event.user },
          // Your own row rides the same event; the profile preview and the avatar in
          // the top bar read currentUser, which would otherwise show the old face.
          currentUser:
            s.currentUser && s.currentUser.id === event.user.id
              ? { ...s.currentUser, ...event.user }
              : s.currentUser,
        }));
        break;

      // Without these three, a tab open since before a group was created renders
      // `@platform-team` as plain text for ever — `resync()` does not refetch groups
      // either, so only a full page load would have picked it up.
      case "group.upserted":
        set((s) => ({
          groups: { ...s.groups, [event.group.id]: event.group },
        }));
        break;

      case "group.deleted":
        set((s) => {
          const groups = { ...s.groups };
          delete groups[event.groupId];
          // Out of both: leaving a deleted group in `myGroupIds` would keep marking old
          // messages as mentioning you, for a group that no longer exists.
          const myGroupIds = new Set(s.myGroupIds);
          myGroupIds.delete(event.groupId);
          return { groups, myGroupIds };
        });
        break;

      case "group.membership":
        set((s) => {
          const myGroupIds = new Set(s.myGroupIds);
          if (event.isMember) myGroupIds.add(event.groupId);
          else myGroupIds.delete(event.groupId);
          return { myGroupIds };
        });
        break;

      case "reminder.due":
        // A reminder is a toast plus the Later badge; the message itself is one
        // click away in the view the toast names.
        useToasts
          .getState()
          .push(
            "info",
            event.note
              ? `Reminder: ${event.note}`
              : "A reminder came due — it’s in Later.",
          );
        break;

      case "agent_run.started":
        set((s) => ({
          agentRuns: { ...s.agentRuns, [event.run.id]: event.run },
        }));
        break;

      case "agent_run.updated":
        set((s) => {
          const run = s.agentRuns[event.runId];
          if (!run) return s;
          return {
            agentRuns: {
              ...s.agentRuns,
              [event.runId]: { ...run, card: event.card },
            },
          };
        });
        break;

      case "agent_run.finished":
        set((s) => {
          const run = s.agentRuns[event.runId];
          if (!run) return s;
          return {
            agentRuns: {
              ...s.agentRuns,
              [event.runId]: {
                ...run,
                status: event.status,
                error: event.error,
                postCount: event.postCount,
                finishedAt: new Date().toISOString(),
              },
            },
          };
        });
        break;

      case "member.joined":
      case "member.left": {
        // Keep what we already hold truthful — DM titles derive from memberIds — and
        // bump a version so screens holding their own member caches know to refetch.
        const joined = event.t === "member.joined";
        set((s) => {
          const channel = s.channels[event.channelId];
          const withMembers =
            channel?.memberIds !== undefined
              ? {
                  channels: {
                    ...s.channels,
                    [event.channelId]: {
                      ...channel,
                      memberIds: joined
                        ? [
                            ...new Set([
                              ...(channel.memberIds ?? []),
                              event.userId,
                            ]),
                          ]
                        : (channel.memberIds ?? []).filter(
                            (id) => id !== event.userId,
                          ),
                    },
                  },
                }
              : {};
          return {
            ...withMembers,
            membershipVersion: {
              ...s.membershipVersion,
              [event.channelId]:
                (s.membershipVersion[event.channelId] ?? 0) + 1,
            },
          };
        });
        break;
      }
      case "hello":
      case "pong":
      case "error":
        break;
    }
  },

  /** After a reconnect, ask the server what we missed rather than assume nothing. */
  resync: async () => {
    const state = get();
    const cursors: Record<string, string> = {};
    for (const [channelId, list] of Object.entries(state.messages)) {
      const newest = list.items
        .filter((m) => !m.id.startsWith("pending-"))
        .at(-1);
      if (newest) cursors[channelId] = newest.id;
    }

    let result: Awaited<ReturnType<typeof api.sync>>;
    try {
      result = await api.sync(cursors);
    } catch {
      // The reconnect very often races the server coming back up, so a failed
      // catch-up is ordinary. Queued sends still deserve their retry now; the
      // catch-up itself retries shortly instead of silently never.
      await get().flushOutbox();
      scheduleResyncRetry(() => void get().resync());
      return;
    }

    set((s) => ({
      channels: Object.fromEntries(result.channels.map((c) => [c.id, c])),
      // Channels whose gap was too large get dropped and refetched on next open.
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(
          ([id]) => !result.resyncChannelIds.includes(id),
        ),
      ),
    }));

    for (const message of result.messages) {
      get().applyEvent({ t: "message.new", message });
    }

    const active = get().activeChannelId;
    if (active && !get().messages[active]?.loaded)
      await get().openChannel(active);
    await get().flushOutbox();
  },

  setPrefs: async (prefs) => {
    // Toasted here rather than at the dozen toggle call sites: a preference switch
    // renders its on-state from the store, so a failed write leaves the control
    // truthful — but only if somebody says the write failed.
    let updated: UserPrefs;
    try {
      ({ prefs: updated } = await api.me.prefs(prefs));
    } catch (err) {
      showError(err);
      return;
    }
    set((s) =>
      s.currentUser
        ? { currentUser: { ...s.currentUser, prefs: updated } }
        : {},
    );
  },

  displayNameOf: (userId) => {
    if (!userId) return "Unknown";
    return get().users[userId]?.displayName ?? "Someone";
  },

  channelTitle: (channel) => {
    if (channel.name) return `#${channel.name}`;
    const me = get().currentUser?.id;
    const others = (channel.memberIds ?? []).filter((id) => id !== me);
    if (others.length === 0) return "You";
    return others.map((id) => get().displayNameOf(id)).join(", ");
  },
}));

function mapChannel(
  messages: Record<string, ChannelMessages>,
  channelId: string,
  fn: (message: Message) => Message,
): Record<string, ChannelMessages> {
  const existing = messages[channelId];
  if (!existing) return messages;
  return {
    ...messages,
    [channelId]: { ...existing, items: existing.items.map(fn) },
  };
}

function setOutbox(
  set: Parameters<StateCreator<State>>[0],
  get: () => State,
  updater: (
    outbox: Record<string, LocalOutboxEntry>,
  ) => Record<string, LocalOutboxEntry>,
): void {
  let nextOutbox: Record<string, LocalOutboxEntry> = {};
  set((state) => {
    nextOutbox = updater(state.outbox);
    return withProjectedOutbox(state, nextOutbox);
  });
  persistOutbox(nextOutbox);
}

function withProjectedOutbox(
  state: State,
  outbox: Record<string, LocalOutboxEntry>,
): Pick<State, "outbox" | "messages" | "threads"> {
  return {
    outbox,
    messages: Object.fromEntries(
      Object.entries(state.messages).map(([channelId, list]) => [
        channelId,
        list.loaded
          ? {
              ...list,
              items: overlayChannelOutbox(
                state.currentUser,
                outbox,
                channelId,
                list.items,
              ),
            }
          : list,
      ]),
    ),
    threads: Object.fromEntries(
      Object.entries(state.threads).map(([rootId, items]) => [
        rootId,
        overlayThreadOutbox(state.currentUser, outbox, rootId, items),
      ]),
    ),
  };
}

function overlayChannelOutbox(
  currentUser: CurrentUser | null,
  outbox: Record<string, LocalOutboxEntry>,
  channelId: string,
  items: Message[],
): Message[] {
  if (!currentUser) return stripPending(items);
  let next = stripPending(items);
  for (const entry of sortOutbox(outbox)) {
    if (entry.channelId === channelId && entry.threadRootId === null) {
      next = upsert(next, materializeOutboxMessage(entry, currentUser.id));
    }
  }
  return next;
}

function overlayThreadOutbox(
  currentUser: CurrentUser | null,
  outbox: Record<string, LocalOutboxEntry>,
  rootId: string,
  items: Message[],
): Message[] {
  if (!currentUser) return stripPending(items);
  let next = stripPending(items);
  for (const entry of sortOutbox(outbox)) {
    if (entry.threadRootId === rootId) {
      next = upsert(next, materializeOutboxMessage(entry, currentUser.id));
    }
  }
  return next;
}

function stripPending(items: Message[]): Message[] {
  return items.filter((message) => !message.id.startsWith("pending-"));
}

/** Wire the socket into the store once, at app start. */
export function connectStoreToSocket(): () => void {
  const unsubscribeEvents = socket.subscribe((event) =>
    useStore.getState().applyEvent(event),
  );
  let hasConnectedOnce = false;
  const unsubscribeStatus = socket.onStatus((status) => {
    useStore.setState({ status });
    if (status === "online" && !hasConnectedOnce) {
      hasConnectedOnce = true;
      void useStore.getState().flushOutbox();
    }
  });
  socket.onReconnect = () => {
    void (async () => {
      await useStore.getState().resync();
      await useStore.getState().flushOutbox();
    })();
  };
  // The browser knows the network came back before the socket does. Its backoff caps
  // at 30 seconds, so a message queued as the wifi dropped could sit for that long
  // after it returned — and sending is REST, not the socket, so the queue does not
  // need to wait for a reconnect to drain. flushOutbox is idempotent on
  // clientMsgId, so racing the socket's own flush costs nothing.
  const onOnline = () => void useStore.getState().flushOutbox();
  window.addEventListener("online", onOnline);

  socket.connect();

  return () => {
    unsubscribeEvents();
    unsubscribeStatus();
    window.removeEventListener("online", onOnline);
    socket.onReconnect = null;
    socket.disconnect();
  };
}
