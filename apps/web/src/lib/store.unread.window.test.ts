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

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    api: { ...actual.api, channels: { ...actual.api.channels, markRead } },
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

beforeEach(() => markRead.mockClear());

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
