// @vitest-environment happy-dom
/** Leaving a message unread, and making that stick.
 *
 * The server half is easy; the client half is the whole problem. Auto-read here is
 * aggressive by design — `openChannel` marks read on arrival, and every `message.new` in
 * the channel you are looking at marks read again — so marking something unread and then
 * receiving one more message would have undone it instantly, silently, and only sometimes.
 *
 * So `suppressReadFor` exists, and these pin the three things that make it behave: it
 * stops auto-read for that channel, it does not stop it for any other, and it is released
 * the moment you open a channel — including the same one, because coming back to
 * something you left unread is exactly when it should be read again.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const markUnread = vi.fn(async () => ({
  readState: { channelId: 'c1', lastReadMessageId: 'm4', mentionCount: 1 },
}));
const markRead = vi.fn(async () => ({}));
const history = vi.fn(async () => ({ messages: [], hasMore: false }));

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      channels: { ...actual.api.channels, markUnread, markRead },
      messages: { ...actual.api.messages, history },
    },
  };
});

vi.mock('./socket.ts', () => ({
  socket: { send: vi.fn(), sendControl: vi.fn(), connect: vi.fn(), close: vi.fn(), onEvent: vi.fn(), onStatus: vi.fn() },
}));

const { useStore } = await import('./store.ts');

/** One channel with one real message, which is all `markRead` needs to want to fire. */
function seed() {
  useStore.setState({
    suppressReadFor: null,
    unreadMarkers: {},
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', lastReadMessageId: null, mentionCount: 0 },
      c2: { id: 'c2', kind: 'public', name: 'random', lastReadMessageId: null, mentionCount: 0 },
    } as never,
    messages: {
      c1: { items: [{ id: 'm5', channelId: 'c1' }] as never, hasMore: false, loading: false, loaded: true },
      c2: { items: [{ id: 'm9', channelId: 'c2' }] as never, hasMore: false, loading: false, loaded: true },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe('marking a message unread', () => {
  it('moves the divider to where the server put the cursor', async () => {
    await useStore.getState().markUnread('c1', 'm5');

    expect(markUnread).toHaveBeenCalledWith('c1', 'm5');
    // The message you marked is the first thing under "New messages", rather than the
    // app simply forgetting where you were.
    expect(useStore.getState().unreadMarkers['c1']).toBe('m4');
  });

  it('stops the channel being read again underneath you', async () => {
    await useStore.getState().markUnread('c1', 'm5');
    await useStore.getState().markRead('c1');

    // One arriving message calls markRead on the channel you are looking at. Without the
    // guard, that would undo the thing you just asked for and nothing would say so.
    expect(markRead).not.toHaveBeenCalled();
  });

  it('does not stop any other channel being read', async () => {
    await useStore.getState().markUnread('c1', 'm5');
    await useStore.getState().markRead('c2');

    expect(markRead).toHaveBeenCalledWith('c2', 'm9');
  });
});

describe('coming back', () => {
  it('releases the suppression when you open a channel', async () => {
    await useStore.getState().markUnread('c1', 'm5');
    expect(useStore.getState().suppressReadFor).toBe('c1');

    await useStore.getState().openChannel('c2');
    expect(useStore.getState().suppressReadFor).toBeNull();
  });

  it('reads the channel again when you return to it', async () => {
    await useStore.getState().markUnread('c1', 'm5');
    await useStore.getState().openChannel('c1');

    // Released on opening the *same* channel too. Coming back to something you left
    // unread is when it should be read — otherwise it could never be cleared.
    expect(markRead).toHaveBeenCalledWith('c1', 'm5');
  });
});
