// @vitest-environment happy-dom
/**
 * Retention (ADR 0039) sends one `history.trimmed` frame per conversation per batch rather
 * than a frame per removed message. A client holding history that old drops it and fetches
 * again; one that is not holding it does nothing. Where the conversation's newest message
 * went, the frame names the newest one left, because a live message folds into the open
 * list only when the list ends at that pointer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const markRead = vi.fn(async () => ({}));
const history = vi.fn();
const thread = vi.fn();

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      channels: { ...actual.api.channels, markRead },
      messages: { ...actual.api.messages, history, thread },
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

function load(items: string[], lastMessageId: string | null, active = "c1") {
  useStore.setState({
    currentUser: { id: "me" },
    activeChannelId: active,
    activeThreadRootId: null,
    suppressReadFor: null,
    messages: {
      c1: { items: items.map((i) => msg(i)), hasMore: true, loading: false, loaded: true, error: false },
    },
    threads: {},
    channels: {
      c1: { id: "c1", kind: "public", name: "general", lastMessageId, hasUnread: false, mentionCount: 0 },
    },
  } as never);
}

beforeEach(() => {
  markRead.mockClear();
  history.mockReset();
  thread.mockReset();
  history.mockResolvedValue({ messages: [msg("m5")], hasMore: false });
});

describe("history.trimmed", () => {
  it("drops a list holding messages that old and fetches the open one again", async () => {
    load(["m1", "m2", "m5"], "m5");

    useStore.getState().applyEvent({ t: "history.trimmed", channelId: "c1", through: "m2" });

    await vi.waitFor(() => expect(history).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual(["m5"]),
    );
  });

  it("leaves a list that holds nothing that old", () => {
    load(["m5", "m6"], "m6");

    useStore.getState().applyEvent({ t: "history.trimmed", channelId: "c1", through: "m2" });

    expect(history).not.toHaveBeenCalled();
    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual(["m5", "m6"]);
  });

  it("does not fetch a conversation nobody has open", () => {
    load(["m1", "m2"], "m2", "elsewhere");

    useStore.getState().applyEvent({ t: "history.trimmed", channelId: "c1", through: "m2" });

    expect(history).not.toHaveBeenCalled();
    expect(useStore.getState().messages["c1"]).toBeUndefined();
  });

  it("moves the conversation's newest-message pointer where the frame says", () => {
    load([], "m2", "elsewhere");

    useStore
      .getState()
      .applyEvent({ t: "history.trimmed", channelId: "c1", through: "m2", lastMessageId: null });

    expect(useStore.getState().channels["c1"]?.lastMessageId).toBeNull();
  });

  it("fetches an open thread whose root it reached", async () => {
    load(["m5"], "m5");
    thread.mockResolvedValue({ messages: [msg("m1", { deletedAt: "2026-10-21T04:40:00Z" })] });
    useStore.setState({
      activeThreadRootId: "m1",
      threads: { m1: [msg("m1"), msg("m3", { threadRootId: "m1" })] },
    } as never);

    useStore.getState().applyEvent({ t: "history.trimmed", channelId: "c1", through: "m1" });

    await vi.waitFor(() => expect(thread).toHaveBeenCalledWith("m1"));
  });
});

describe("an empty conversation", () => {
  it("shows the first message somebody else sends into it", () => {
    load([], null);

    useStore.getState().applyEvent({ t: "message.new", message: msg("m1") } as never);

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual(["m1"]);
  });
});
