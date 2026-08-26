// @vitest-environment happy-dom
/** Leaving a channel, on this side of the wire.
 *
 * `POST /leave` unsubscribes the socket and broadcasts `member.left` — an event about
 * somebody leaving *a* channel, carrying no view of it, which the store has always
 * ignored. So the server is right and our copy is stale: `membership` is still set and
 * the sidebar still lists the channel as one you are in.
 *
 * The three behaviours below are each silently wrong in a different way if dropped, and
 * none of them shows up until the next reload, which is where a bug like this hides.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelWithState } from '@blob/shared';

const leave = vi.fn(async () => ({ ok: true as const }));

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: { ...actual.api, channels: { ...actual.api.channels, leave } } };
});

vi.mock('./socket.ts', () => ({
  socket: { send: vi.fn(), sendControl: vi.fn(), connect: vi.fn(), close: vi.fn(), onEvent: vi.fn(), onStatus: vi.fn() },
}));

const { useStore } = await import('./store.ts');

function channel(id: string, overrides: Partial<ChannelWithState> = {}): ChannelWithState {
  return {
    id,
    kind: 'public',
    name: id,
    topic: null,
    archivedAt: null,
    membership: { notifyLevel: 'mentions', isStarred: false },
    ...overrides,
  } as ChannelWithState;
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    channels: {
      open: channel('open'),
      secret: channel('secret', { kind: 'private' }),
    },
    activeChannelId: null,
    activeThreadRootId: null,
  });
});

describe('leaving a channel', () => {
  it('keeps a public one, without you in it', async () => {
    await useStore.getState().leaveChannel('open');

    const left = useStore.getState().channels.open;
    // Still there to be rejoined — the sidebar moves it to the browsable list, which
    // is what `membership === null` means to every reader of this state.
    expect(left).toBeDefined();
    expect(left?.membership).toBeNull();
  });

  it('drops a private one entirely', async () => {
    await useStore.getState().leaveChannel('secret');

    // assert_channel_access refuses a private channel to a non-member from here on, so
    // keeping the row would offer a door that answers 404.
    expect(useStore.getState().channels.secret).toBeUndefined();
  });

  it('stops showing the one you were reading', async () => {
    useStore.setState({ activeChannelId: 'open', activeThreadRootId: 'm1' });
    await useStore.getState().leaveChannel('open');

    expect(useStore.getState().activeChannelId).toBeNull();
    expect(useStore.getState().activeThreadRootId).toBeNull();
  });

  it('leaves the channel you are reading alone when you leave a different one', async () => {
    useStore.setState({ activeChannelId: 'open' });
    await useStore.getState().leaveChannel('secret');

    expect(useStore.getState().activeChannelId).toBe('open');
  });

  it('tells the server before touching local state', async () => {
    leave.mockRejectedValueOnce(new Error('offline'));

    await expect(useStore.getState().leaveChannel('open')).rejects.toThrow();
    // A failed request must not leave the sidebar claiming you left. The await comes
    // first for exactly this reason.
    expect(useStore.getState().channels.open?.membership).not.toBeNull();
  });
});
