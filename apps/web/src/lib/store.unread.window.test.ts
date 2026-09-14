// @vitest-environment happy-dom
/**
 * A live message must not mark a backlog it never showed you as read.
 *
 * Following a permalink, a search result, a saved item or a pin loads ~50 messages
 * *around* something old and deliberately does not mark the channel read — `openChannel`
 * says so: "arriving at an old message must not mark everything after it as read". But
 * that skip only covered the moment of arrival. `loaded` was true afterwards, so the next
 * live message was appended to that window — directly beneath a message hundreds older,
 * the gap invisible — and then acked, marking every unread message in between as read.
 *
 * The test is whether the loaded list reached the channel's newest message *before* the
 * new one arrived. Afterwards it always looks that way: the arriving message becomes both
 * the last loaded item and the channel's lastMessageId.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const markRead = vi.fn(async () => ({}));
const sendApi = vi.fn();
const history = vi.fn();

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      channels: { ...actual.api.channels, markRead },
      messages: { ...actual.api.messages, send: sendApi, history },
    },
  };
});

vi.mock("./socket.ts", () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

const { useStore } = await import("./store.ts");

const msg = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    channelId: "c1",
    authorId: "them",
    body: id,
    kind: "user",
    createdAt: "2026-09-01T10:00:00.000Z",
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    ...extra,
  }) as never;

/** `tail` is the channel's newest message, which may be far past what is loaded. */
function loadChannel(
  items: string[],
  tail: string,
  extra: Record<string, unknown> = {},
) {
  useStore.setState({
    currentUser: { id: "me" },
    activeChannelId: "c1",
    suppressReadFor: null,
    messages: {
      c1: {
        items: items.map((i) => msg(i)),
        hasMore: true,
        loading: false,
        loaded: true,
        error: false,
      },
    },
    channels: {
      c1: {
        id: "c1",
        kind: "public",
        name: "general",
        lastMessageId: tail,
        hasUnread: false,
        mentionCount: 0,
      },
    },
    ...extra,
  } as never);
}

beforeEach(() => {
  markRead.mockClear();
  sendApi.mockReset();
  history.mockReset();
});

describe("a message arriving while the tail is on screen", () => {
  it("is folded in and marks the channel read", () => {
    loadChannel(["m1", "m2"], "m2");

    useStore
      .getState()
      .applyEvent({ t: "message.new", message: msg("m3") } as never);

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    expect(markRead).toHaveBeenCalledWith("c1", "m3");
  });
});

describe("a message arriving while an old window is on screen", () => {
  it("does not mark the unseen backlog read", () => {
    loadChannel(["m100", "m101"], "m900");

    useStore
      .getState()
      .applyEvent({ t: "message.new", message: msg("m901") } as never);

    expect(markRead).not.toHaveBeenCalled();
  });

  it("does not append it after a message hundreds older", () => {
    loadChannel(["m100", "m101"], "m900");

    useStore
      .getState()
      .applyEvent({ t: "message.new", message: msg("m901") } as never);

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m100",
      "m101",
    ]);
  });

  it("still moves the channel to the newest message", () => {
    loadChannel(["m100", "m101"], "m900");

    useStore
      .getState()
      .applyEvent({ t: "message.new", message: msg("m901") } as never);

    expect(useStore.getState().channels["c1"]?.lastMessageId).toBe("m901");
  });
});

describe("a channel someone asked to keep unread", () => {
  it("stays unread when a message arrives in it", () => {
    loadChannel(["m1", "m2"], "m2", { suppressReadFor: "c1" });

    useStore
      .getState()
      .applyEvent({ t: "message.new", message: msg("m3") } as never);

    expect(useStore.getState().channels["c1"]?.hasUnread).toBe(true);
  });

  it("but your own message never marks it unread", () => {
    loadChannel(["m1", "m2"], "m2", { suppressReadFor: "c1" });

    useStore.getState().applyEvent({
      t: "message.new",
      message: msg("m3", { authorId: "me" }),
    } as never);

    expect(useStore.getState().channels["c1"]?.hasUnread).toBe(false);
  });
});

/**
 * Deleting the newest message must not strand the tail pointer.
 *
 * The third route to one symptom. `wasAtTail` above compares the last loaded row against
 * the channel's `lastMessageId`, and a pointer left naming a row that no longer exists
 * never matches again — so every later message in that channel is dropped from the open
 * view and only a reload brings it back. A thread reply used to advance the pointer to
 * something the channel list could never hold; a replay after a reconnect used to walk it
 * backwards; and deleting the newest message stranded it. The rule the three share is
 * that the pointer has to be maintained wherever the tail moves.
 */
describe("deleting the newest message", () => {
  it("moves the tail pointer back, so later messages still arrive live", () => {
    loadChannel(["m1", "m2"], "m2");

    useStore
      .getState()
      .applyEvent({ t: "message.deleted", id: "m2", channelId: "c1", threadRootId: null } as never);

    expect(useStore.getState().channels["c1"]?.lastMessageId).toBe("m1");

    // The part that was broken: this used to be dropped in silence.
    useStore
      .getState()
      .applyEvent({ t: "message.new", message: msg("m3") } as never);

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("leaves the pointer alone when the deleted message was not the newest", () => {
    loadChannel(["m1", "m2"], "m2");

    useStore
      .getState()
      .applyEvent({ t: "message.deleted", id: "m1", channelId: "c1", threadRootId: null } as never);

    expect(useStore.getState().channels["c1"]?.lastMessageId).toBe("m2");
  });

  it("clears the pointer when the channel is emptied, rather than naming a ghost", () => {
    loadChannel(["m1"], "m1");

    useStore
      .getState()
      .applyEvent({ t: "message.deleted", id: "m1", channelId: "c1", threadRootId: null } as never);

    expect(useStore.getState().channels["c1"]?.lastMessageId).toBeNull();
  });
});

/**
 * The fourth route, and the only one where dropping the message is indefensible.
 *
 * Opening a channel with more than half a page of unread loads a window *around* the
 * read cursor — `openChannel`'s `jumpToUnread` — and `around` returns at most 25 rows
 * after it. So the list you are looking at very often does not reach the channel's
 * newest message, and `wasAtTail` above is false for the rest of the session.
 *
 * For somebody else's message that is right: it would land beneath a row hundreds
 * older with the gap invisible. For your own it is not. You typed it, the server
 * stored it, the optimistic row is removed the moment the 201 comes back — and then
 * the real one is dropped, so the message you just sent is simply not there, and only
 * a reload brings it back.
 *
 * The answer is Slack's: sending takes you to where the message landed.
 */
describe("a message you send from a window behind the tail", () => {
  it("is on screen afterwards, with the messages it followed", async () => {
    loadChannel(["m100", "m101"], "m900", { status: "online" });
    sendApi.mockResolvedValue({
      message: msg("m901", { authorId: "me" }),
    });
    history.mockResolvedValue({
      messages: [msg("m899"), msg("m900"), msg("m901", { authorId: "me" })],
      hasMore: true,
    });

    await useStore.getState().sendMessage("c1", "hello");

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m899",
      "m900",
      "m901",
    ]);
  });

  it("costs no extra request when the list already reached the tail", async () => {
    loadChannel(["m1", "m2"], "m2", { status: "online" });
    sendApi.mockResolvedValue({ message: msg("m3", { authorId: "me" }) });

    await useStore.getState().sendMessage("c1", "hello");

    expect(history).not.toHaveBeenCalled();
    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("leaves the channel where it is for a thread reply, which is not in it", async () => {
    loadChannel(["m100", "m101"], "m900", { status: "online" });
    sendApi.mockResolvedValue({
      message: msg("m901", { authorId: "me", threadRootId: "m50" }),
    });

    await useStore.getState().sendMessage("c1", "hello", "m50");

    expect(history).not.toHaveBeenCalled();
  });
});

describe("a queued message replayed after a reconnect", () => {
  it("is shown too — it is still yours, only delayed", async () => {
    loadChannel(["m100", "m101"], "m900", {
      status: "online",
      outbox: {
        q1: {
          clientMsgId: "q1",
          channelId: "c1",
          threadRootId: null,
          body: "hello",
          attachmentIds: [],
          alsoInChannel: false,
          createdAt: "2026-09-01T10:00:00.000Z",
          status: "queued",
          attempts: 0,
          lastError: null,
        },
      },
    });
    sendApi.mockResolvedValue({ message: msg("m901", { authorId: "me" }) });
    history.mockResolvedValue({
      messages: [msg("m900"), msg("m901", { authorId: "me" })],
      hasMore: true,
    });

    await useStore.getState().flushOutbox();

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m900",
      "m901",
    ]);
  });
});
