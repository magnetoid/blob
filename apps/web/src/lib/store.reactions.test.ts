// @vitest-environment happy-dom
/**
 * A reaction lands under the pointer, not after the round trip.
 *
 * Reacting was the last deliberate thing a person could do here that still waited: the
 * chip appeared only when the socket's own `reaction.added` frame came back, so on a slow
 * connection a hit read as a miss and the `reaction-pop` keyframe played whenever the
 * server got round to it. Sending, saving and every other write already apply first and
 * roll back on failure; this one now does too.
 *
 * Which puts the whole weight on `withReaction` being idempotent. The optimistic add and
 * the confirming frame are the *same* edit applied twice, so the second application has
 * to change nothing — not "add a duplicate id the renderer happens to dedupe", nothing,
 * down to the array's reference identity, because that identity is what keeps the list
 * from re-rendering. The mirror case is a `reaction.removed` for somebody who is already
 * gone, which arrives whenever two clients race.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@blob/shared";

const react = vi.fn((): Promise<unknown> => Promise.resolve({}));
const unreact = vi.fn((): Promise<unknown> => Promise.resolve({}));

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      messages: { ...actual.api.messages, react, unreact },
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

const ME = "u-me";
const THEM = "u-them";

const msg = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    channelId: "c1",
    authorId: THEM,
    body: id,
    kind: "user",
    createdAt: "2026-09-16T10:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    ...extra,
  }) as unknown as Message;

/**
 * One channel holding `m1`, and a thread on it holding `m1` and a reply. A root's
 * reactions live in both lists, which is why the store touches both.
 */
function seed(reactions: unknown[] = []) {
  useStore.setState({
    currentUser: { id: ME, displayName: "Me" },
    channels: {
      c1: { id: "c1", kind: "public", name: "general", lastMessageId: "m1" },
    },
    messages: {
      c1: {
        items: [msg("m1", { reactions })],
        loaded: true,
        loading: false,
        hasMore: false,
      },
    },
    threads: {
      m1: [msg("m1", { reactions }), msg("r1", { threadRootId: "m1" })],
    },
  } as never);
}

/** The chips on `m1`, as the message list would draw them. */
const chips = () =>
  useStore.getState().messages.c1?.items[0]?.reactions ?? "no message";

/** The loaded items array, whose identity is the re-render the store is avoiding. */
const items = () => useStore.getState().messages.c1?.items;

const frame = (
  t: "reaction.added" | "reaction.removed",
  userId: string,
  extra: Record<string, unknown> = {},
) =>
  ({
    t,
    messageId: "m1",
    channelId: "c1",
    threadRootId: null,
    emoji: "👍",
    userId,
    ...extra,
  }) as never;

beforeEach(() => {
  // `mockReset`, not `clearAllMocks`: several tests queue a `…Once` implementation, and
  // a queued one that its own test never reaches would be handed to the next test
  // instead — which shows up as an unrelated test hanging on a promise nobody settles.
  for (const mock of [react, unreact]) {
    mock.mockReset();
    mock.mockImplementation(() => Promise.resolve({}));
  }
});

describe("reacting", () => {
  it("shows the chip before the request resolves", async () => {
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => (settle = resolve));
    react.mockImplementationOnce(() => pending);

    seed();
    const done = useStore
      .getState()
      .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍");

    // Not awaited: this is the frame the click paints in.
    expect(chips()).toEqual([{ emoji: "👍", userIds: [ME] }]);
    // A root is in two lists at once, held as separate objects, and the thread panel
    // can be open beside the channel it is in. Both have to move on the click.
    expect(useStore.getState().threads.m1?.[0]?.reactions).toEqual([
      { emoji: "👍", userIds: [ME] },
    ]);
    expect(react).toHaveBeenCalledWith("m1", "👍");

    settle();
    await done;
    expect(chips()).toEqual([{ emoji: "👍", userIds: [ME] }]);
  });

  it("joins a chip somebody else started, keeping the order people reacted in", async () => {
    seed([{ emoji: "👍", userIds: [THEM] }]);
    await useStore
      .getState()
      .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍");

    expect(chips()).toEqual([{ emoji: "👍", userIds: [THEM, ME] }]);
  });

  it("takes the chip back off when the request fails, and rethrows", async () => {
    react.mockRejectedValueOnce(new Error("offline"));

    seed();
    await expect(
      useStore
        .getState()
        .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍"),
    ).rejects.toThrow("offline");

    // The toast the caller shows is the whole story; a chip left behind would claim a
    // reaction the server never heard of, and no frame is coming to correct it.
    expect(chips()).toEqual([]);
  });

  it("leaves other people's chip standing when its own add fails", async () => {
    react.mockRejectedValueOnce(new Error("offline"));

    seed([{ emoji: "👍", userIds: [THEM] }]);
    await expect(
      useStore
        .getState()
        .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍"),
    ).rejects.toThrow("offline");

    expect(chips()).toEqual([{ emoji: "👍", userIds: [THEM] }]);
  });

  it("reads the direction off the store, so a second click takes it back", async () => {
    // Both requests are left hanging, which is the whole point: the second click happens
    // while the first is still in flight, so React has not re-rendered and the `message`
    // it is handed still says nobody has reacted. The store knows better. Before this,
    // both clicks read the stale prop and both fired `react`.
    let settleAdd!: () => void;
    let settleRemove!: () => void;
    react.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settleAdd = resolve)),
    );
    unreact.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settleRemove = resolve)),
    );

    seed();
    const stale = useStore.getState().messages.c1!.items[0]!;
    const first = useStore.getState().toggleReaction(stale, "👍");
    const second = useStore.getState().toggleReaction(stale, "👍");

    expect(chips()).toEqual([]);
    expect(react).toHaveBeenCalledTimes(1);
    expect(unreact).toHaveBeenCalledTimes(1);

    settleAdd();
    settleRemove();
    await Promise.all([first, second]);
    expect(chips()).toEqual([]);
  });

  it("reaches a reply in its own thread list", async () => {
    seed();
    await useStore.getState().toggleReaction(
      useStore.getState().threads.m1![1]!,
      "🎉",
    );

    expect(useStore.getState().threads.m1?.[1]?.reactions).toEqual([
      { emoji: "🎉", userIds: [ME] },
    ]);
  });
});

describe("taking a reaction back", () => {
  it("removes the id at once, and the emptied chip with it", async () => {
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => (settle = resolve));
    unreact.mockImplementationOnce(() => pending);

    seed([{ emoji: "👍", userIds: [ME] }]);
    const done = useStore
      .getState()
      .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍");

    expect(chips()).toEqual([]);
    expect(unreact).toHaveBeenCalledWith("m1", "👍");

    settle();
    await done;
    expect(chips()).toEqual([]);
  });

  it("leaves the chip when other people are still in it", async () => {
    seed([{ emoji: "👍", userIds: [THEM, ME] }]);
    await useStore
      .getState()
      .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍");

    expect(chips()).toEqual([{ emoji: "👍", userIds: [THEM] }]);
  });

  it("puts it back when the request fails, and rethrows", async () => {
    unreact.mockRejectedValueOnce(new Error("offline"));

    seed([{ emoji: "👍", userIds: [ME] }]);
    await expect(
      useStore
        .getState()
        .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍"),
    ).rejects.toThrow("offline");

    expect(chips()).toEqual([{ emoji: "👍", userIds: [ME] }]);
  });
});

describe("the frame that confirms it", () => {
  it("leaves exactly one id after an optimistic add", async () => {
    seed();
    await useStore
      .getState()
      .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍");
    const before = items();

    useStore.getState().applyEvent(frame("reaction.added", ME));

    expect(chips()).toEqual([{ emoji: "👍", userIds: [ME] }]);
    // Nothing changed, so nothing re-renders. `mapItems` reads reference identity, and
    // it only gets it because the helper returned the very message it was handed.
    expect(items()).toBe(before);
  });

  it("changes nothing when it removes a reaction already taken back", async () => {
    seed([{ emoji: "👍", userIds: [ME] }]);
    await useStore
      .getState()
      .toggleReaction(useStore.getState().messages.c1!.items[0]!, "👍");
    const before = items();

    useStore.getState().applyEvent(frame("reaction.removed", ME));

    expect(chips()).toEqual([]);
    expect(items()).toBe(before);
  });

  it("ignores a removal for somebody who was never in the chip", () => {
    seed([{ emoji: "👍", userIds: [THEM] }]);
    const before = items();

    useStore.getState().applyEvent(frame("reaction.removed", ME));

    expect(chips()).toEqual([{ emoji: "👍", userIds: [THEM] }]);
    expect(items()).toBe(before);
  });

  it("still carries somebody else's reaction, which is the point of the socket", () => {
    seed();
    useStore.getState().applyEvent(frame("reaction.added", THEM));

    expect(chips()).toEqual([{ emoji: "👍", userIds: [THEM] }]);
  });
});
