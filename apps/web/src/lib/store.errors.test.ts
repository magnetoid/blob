// @vitest-environment happy-dom
/** What the store does when the server does not answer.
 *
 * Four paths, all previously unhandled rejections: a channel whose history fetch
 * fails claimed "This is the start of #channel" forever; a failed thread fetch left
 * a blank panel open; a failed resync silently skipped the outbox flush, so queued
 * messages sat unsent after the very reconnect that should have sent them; and a failed
 * *scrollback* left `loading` true for ever, which is the flag the "Load earlier
 * messages" button is disabled by — so one blip cost the reader everything above the
 * fold until they reloaded the page.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const history = vi.fn();
const thread = vi.fn();
const sync = vi.fn();
// `openChannel` acks the newest message on its way out; without this the tests below
// reach the real client and fail on the network rather than on what they assert.
const markRead = vi.fn(async () => ({ readState: {} }));

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      messages: { ...actual.api.messages, history, thread },
      channels: { ...actual.api.channels, markRead },
      sync,
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
    // Both hand back an unsubscribe, which `connectStoreToSocket` calls on teardown.
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

const { useStore, connectStoreToSocket } = await import("./store.ts");
const { useToasts } = await import("./toasts.ts");

beforeEach(() => {
  history.mockReset();
  thread.mockReset();
  sync.mockReset();
  markRead.mockClear();
  useStore.setState({
    messages: {},
    threads: {},
    activeChannelId: null,
    activeThreadRootId: null,
    outbox: {},
  });
  useToasts.setState({ toasts: [] });
});

describe("openChannel", () => {
  it("a failed history fetch becomes an error state, not an empty channel", async () => {
    history.mockRejectedValueOnce(new Error("server on fire"));

    await useStore.getState().openChannel("c1");

    const channel = useStore.getState().messages["c1"];
    expect(channel?.loading).toBe(false);
    expect(channel?.loaded).toBe(false);
    expect(channel?.error).toBe(true);
    // And somebody said so.
    expect(useToasts.getState().toasts.map((t) => t.text)).toContain(
      "server on fire",
    );
  });

  it("a retry after failure clears the error", async () => {
    history.mockRejectedValueOnce(new Error("blip"));
    await useStore.getState().openChannel("c1");
    expect(useStore.getState().messages["c1"]?.error).toBe(true);

    history.mockResolvedValueOnce({ messages: [], hasMore: false });
    await useStore.getState().openChannel("c1");
    const channel = useStore.getState().messages["c1"];
    expect(channel?.error).toBe(false);
    expect(channel?.loaded).toBe(true);
  });
});

describe("openThread", () => {
  it("a failed thread fetch closes the panel instead of leaving it blank", async () => {
    thread.mockRejectedValueOnce(new Error("no thread for you"));

    await useStore.getState().openThread("root1");

    expect(useStore.getState().activeThreadRootId).toBeNull();
    expect(useToasts.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe("resync", () => {
  it("a failed catch-up still flushes the outbox", async () => {
    sync.mockRejectedValueOnce(new Error("still restarting"));
    const flushed = vi.fn(async () => {});
    useStore.setState({ flushOutbox: flushed });

    await useStore.getState().resync();

    expect(flushed).toHaveBeenCalled();
  });
});

describe("coming back online", () => {
  it("drains the outbox without waiting for the socket", async () => {
    // The socket's backoff caps at 30 seconds, so a message queued as the wifi dropped
    // could sit that long after it came back. Sending is REST, so the queue does not
    // need the socket at all.
    const flushed = vi.fn(async () => {});
    useStore.setState({ flushOutbox: flushed });
    const teardown = connectStoreToSocket();

    window.dispatchEvent(new Event("online"));
    await Promise.resolve();

    expect(flushed).toHaveBeenCalled();
    teardown();
  });

  it("stops listening once the socket is torn down", () => {
    const flushed = vi.fn(async () => {});
    useStore.setState({ flushOutbox: flushed });
    connectStoreToSocket()();

    window.dispatchEvent(new Event("online"));

    expect(flushed).not.toHaveBeenCalled();
  });
});

describe("loadOlder", () => {
  const loaded = (items: { id: string }[]) => ({
    messages: {
      c1: { items, hasMore: true, loading: false, loaded: true, error: false },
    },
  });

  it('a failed page leaves the button usable instead of stuck on "Loading…"', async () => {
    // `loading` is what disables the button and freezes its label, so a stuck flag is a
    // dead control, not just stale state.
    useStore.setState(loaded([{ id: "m2" }]) as never);
    history.mockRejectedValueOnce(new Error("network went away"));

    await useStore.getState().loadOlder("c1");

    expect(useStore.getState().messages["c1"]?.loading).toBe(false);
    expect(useToasts.getState().toasts.map((t) => t.text)).toContain(
      "network went away",
    );
  });

  it("keeps what was already loaded, and does not claim the history ended", async () => {
    // Nothing is wrong with the messages already on screen, and turning `hasMore` off
    // would tell the reader the conversation starts here.
    useStore.setState(loaded([{ id: "m2" }]) as never);
    history.mockRejectedValueOnce(new Error("nope"));

    await useStore.getState().loadOlder("c1");

    const channel = useStore.getState().messages["c1"];
    expect(channel?.items.map((m) => m.id)).toEqual(["m2"]);
    expect(channel?.hasMore).toBe(true);
  });

  it("a retry after a failure loads the page", async () => {
    useStore.setState(loaded([{ id: "m2" }]) as never);
    history.mockRejectedValueOnce(new Error("blip"));
    await useStore.getState().loadOlder("c1");

    history.mockResolvedValueOnce({ messages: [{ id: "m1" }], hasMore: false });
    await useStore.getState().loadOlder("c1");

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
  });
});

describe("a message that arrives while the first page is loading", () => {
  it("is not thrown away by the response", async () => {
    // The window is small — one request — but the loss is permanent: nothing refetches
    // a channel that is already `loaded`, so the message is gone until a reload.
    let resolveHistory: (value: unknown) => void = () => {};
    history.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    useStore.setState({
      currentUser: { id: "me" },
      channels: {
        c1: { id: "c1", kind: "public", name: "general", lastMessageId: "m1" },
      },
    } as never);

    const opening = useStore.getState().openChannel("c1");

    // The socket delivers a new message while the request is still in flight.
    useStore.getState().applyEvent({
      t: "message.new",
      message: {
        id: "m2",
        channelId: "c1",
        authorId: "them",
        body: "live one",
        kind: "user",
        createdAt: "2026-09-01T10:00:00.000Z",
        threadRootId: null,
        replyCount: 0,
        reactions: [],
        attachments: [],
        mentionUserIds: [],
        mentionGroupIds: [],
      },
    } as never);

    resolveHistory({
      messages: [
        {
          id: "m1",
          channelId: "c1",
          authorId: "them",
          body: "older",
          kind: "user",
          createdAt: "2026-09-01T09:00:00.000Z",
          threadRootId: null,
          replyCount: 0,
          reactions: [],
          attachments: [],
          mentionUserIds: [],
          mentionGroupIds: [],
        },
      ],
      hasMore: false,
    });
    await opening;

    expect(useStore.getState().messages["c1"]?.items.map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
  });
});
