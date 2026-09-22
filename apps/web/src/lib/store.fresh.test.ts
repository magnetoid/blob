// @vitest-environment happy-dom
/**
 * A message arrives once, and only when it actually arrived.
 *
 * The list is virtualised: a row mounts every time it scrolls into view and on every
 * channel switch, so an entrance keyed to mounting would replay on all of those — which
 * is why arriving was refused outright by the last motion pass. The store now says which
 * ids are arriving: somebody else's message landing live in the conversation on screen,
 * and your own the moment you send it. These pin who gets a mark and who does not, that
 * a send's mark survives the swap to the server's copy, and that every mark expires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendApi = vi.fn();
const history = vi.fn();
const markRead = vi.fn(async () => ({}));

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      channels: { ...actual.api.channels, markRead },
      messages: { ...actual.api.messages, send: sendApi, history },
      agentRuns: { forChannel: vi.fn(async () => ({ runs: [] })) },
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
const { FALLBACK_MS } = await import("./usePresence.ts");

const msg = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    channelId: "c1",
    authorId: "them",
    body: id,
    kind: "user",
    createdAt: "2026-09-01T10:00:00.000Z",
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    ...extra,
  }) as never;

/** #c1 open and loaded to its tail; #c2 exists and is not the one on screen. */
function seed() {
  useStore.setState({
    status: "online",
    currentUser: { id: "me" } as never,
    activeChannelId: "c1",
    activeThreadRootId: null,
    outbox: {},
    freshMessages: new Map(),
    threads: {},
    messages: {
      c1: { items: [msg("01a")], hasMore: false, loading: false, loaded: true },
      c2: { items: [msg("01b", { channelId: "c2" })], hasMore: false, loading: false, loaded: true },
    },
    channels: {
      c1: { id: "c1", lastMessageId: "01a", lastReadMessageId: "01a" },
      c2: { id: "c2", lastMessageId: "01b", lastReadMessageId: "01b" },
    } as never,
  });
}

const fresh = () => useStore.getState().freshMessages;

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a message arriving", () => {
  it("is marked when somebody else's lands live in the conversation on screen", () => {
    useStore.getState().applyEvent({ t: "message.new", message: msg("01c") });

    // Marked, but not yet begun: the entrance is timed from the row that draws it, not
    // from the frame, which can land well before the render does.
    expect(fresh().has("01c")).toBe(true);
    expect(fresh().get("01c")).toBeNull();
    useStore.getState().beginFresh("01c", 500);
    expect(fresh().get("01c")).toBe(500);

    // A second row showing the same message keeps the one start.
    useStore.getState().beginFresh("01c", 900);
    expect(fresh().get("01c")).toBe(500);

    // And settled once, by the row whose entrance has ended.
    useStore.getState().settleFresh("01c");
    expect(fresh().has("01c")).toBe(false);
  });

  it("is not marked when it is one this tab sent, coming back over the socket", () => {
    // Yours were marked when you sent them; the frame is the confirmation, and marking
    // it would play the entrance a second time on the row you are looking at.
    sendApi.mockReturnValueOnce(new Promise(() => {}));
    void useStore.getState().sendMessage("c1", "hello");
    const pending = useStore
      .getState()
      .messages.c1!.items.find((m) => m.id.startsWith("pending-"))!;

    useStore.getState().applyEvent({
      t: "message.new",
      message: msg("01h", { authorId: "me", clientMsgId: pending.clientMsgId, body: "hello" }),
    });

    expect(fresh().has("01h")).toBe(false);
  });

  it("is marked when it is your own, sent from somewhere else", () => {
    // The same person on a phone: nothing in this tab sent it, so it arrives here the
    // way anybody's message does.
    useStore.getState().applyEvent({
      t: "message.new",
      message: msg("01c", { authorId: "me", clientMsgId: "sent-from-my-phone" }),
    });

    expect(fresh().has("01c")).toBe(true);
  });

  it("is not marked in a conversation you are not looking at", () => {
    // Its row is not on screen to use the mark, and opening the channel later must not
    // find one waiting.
    useStore.getState().applyEvent({
      t: "message.new",
      message: msg("01c", { channelId: "c2" }),
    });

    expect(fresh().size).toBe(0);
  });

  it("is not marked for a copy of a row that is already there", () => {
    // A replay, or the socket repeating what a command's response already applied: the
    // row is on screen, and somebody may be reading it.
    useStore.getState().applyEvent({ t: "message.new", message: msg("01a") });

    expect(fresh().size).toBe(0);
  });

  it("is marked in the open thread", () => {
    useStore.setState({
      activeThreadRootId: "01a",
      threads: { "01a": [msg("01a")] },
    });
    useStore.getState().applyEvent({
      t: "message.new",
      message: msg("01d", { threadRootId: "01a" }),
    });

    expect(fresh().has("01d")).toBe(true);
  });

  it("is never marked by a page of history", async () => {
    useStore.setState({ activeChannelId: null });
    history.mockResolvedValueOnce({
      messages: [msg("01e", { channelId: "c3" }), msg("01f", { channelId: "c3" })],
      hasMore: false,
    });
    useStore.setState((s) => ({
      channels: {
        ...s.channels,
        c3: { id: "c3", lastMessageId: "01f", lastReadMessageId: "01f" },
      } as never,
    }));

    await useStore.getState().openChannel("c3");

    expect(useStore.getState().messages.c3?.items).toHaveLength(2);
    expect(fresh().size).toBe(0);
  });

  it("expires on its own when no row settles it", () => {
    // A row scrolled out of reach never consumes its mark, and without this it would
    // play the entrance whenever that row finally mounted.
    vi.useFakeTimers();
    useStore.getState().applyEvent({ t: "message.new", message: msg("01c") });
    expect(fresh().has("01c")).toBe(true);

    vi.advanceTimersByTime(FALLBACK_MS);

    expect(fresh().has("01c")).toBe(false);
  });
});

describe("a message you send", () => {
  it("is marked the moment its pending row exists", () => {
    sendApi.mockReturnValueOnce(new Promise(() => {}));
    void useStore.getState().sendMessage("c1", "hello");

    const pending = useStore
      .getState()
      .messages.c1?.items.find((m) => m.id.startsWith("pending-"));
    expect(pending).toBeDefined();
    expect(fresh().has(pending!.id)).toBe(true);
  });

  it("hands its mark to the server's copy, start time and all", async () => {
    // The server's copy is a new row under a new key, usually while the pending one is
    // still arriving. Keeping the moment the pending row began is what lets the new one
    // carry on from there rather than start again.
    let resolve!: (value: unknown) => void;
    sendApi.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const sending = useStore.getState().sendMessage("c1", "hello");

    const pending = useStore
      .getState()
      .messages.c1!.items.find((m) => m.id.startsWith("pending-"))!;
    // What the pending row does as it is first drawn.
    useStore.getState().beginFresh(pending.id, 1234);

    resolve({
      message: msg("01g", { authorId: "me", clientMsgId: pending.clientMsgId, body: "hello" }),
    });
    await sending;

    expect(fresh().has(pending.id)).toBe(false);
    expect(fresh().get("01g")).toBe(1234);
  });

  it("does not hand on a mark whose entrance has already been settled", async () => {
    // A slow send: the pending row finished arriving long ago, so the server's copy just
    // replaces it, still.
    let resolve!: (value: unknown) => void;
    sendApi.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const sending = useStore.getState().sendMessage("c1", "hello");
    const pending = useStore
      .getState()
      .messages.c1!.items.find((m) => m.id.startsWith("pending-"))!;
    useStore.getState().settleFresh(pending.id);

    resolve({
      message: msg("01g", { authorId: "me", clientMsgId: pending.clientMsgId, body: "hello" }),
    });
    await sending;

    expect(fresh().size).toBe(0);
  });
});
