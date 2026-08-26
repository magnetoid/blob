// @vitest-environment happy-dom
/** What the store does when the server does not answer.
 *
 * Three paths, all previously unhandled rejections: a channel whose history fetch
 * fails claimed "This is the start of #channel" forever; a failed thread fetch left
 * a blank panel open; a failed resync silently skipped the outbox flush, so queued
 * messages sat unsent after the very reconnect that should have sent them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.fn();
const thread = vi.fn();
const sync = vi.fn();

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      messages: { ...actual.api.messages, history, thread },
      sync,
    },
  };
});

vi.mock('./socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(),
    onStatus: vi.fn(),
  },
}));

const { useStore } = await import('./store.ts');
const { useToasts } = await import('./toasts.ts');

beforeEach(() => {
  history.mockReset();
  thread.mockReset();
  sync.mockReset();
  useStore.setState({
    messages: {},
    threads: {},
    activeChannelId: null,
    activeThreadRootId: null,
    outbox: {},
  });
  useToasts.setState({ toasts: [] });
});

describe('openChannel', () => {
  it('a failed history fetch becomes an error state, not an empty channel', async () => {
    history.mockRejectedValueOnce(new Error('server on fire'));

    await useStore.getState().openChannel('c1');

    const channel = useStore.getState().messages['c1'];
    expect(channel?.loading).toBe(false);
    expect(channel?.loaded).toBe(false);
    expect(channel?.error).toBe(true);
    // And somebody said so.
    expect(useToasts.getState().toasts.map((t) => t.text)).toContain('server on fire');
  });

  it('a retry after failure clears the error', async () => {
    history.mockRejectedValueOnce(new Error('blip'));
    await useStore.getState().openChannel('c1');
    expect(useStore.getState().messages['c1']?.error).toBe(true);

    history.mockResolvedValueOnce({ messages: [], hasMore: false });
    await useStore.getState().openChannel('c1');
    const channel = useStore.getState().messages['c1'];
    expect(channel?.error).toBe(false);
    expect(channel?.loaded).toBe(true);
  });
});

describe('openThread', () => {
  it('a failed thread fetch closes the panel instead of leaving it blank', async () => {
    thread.mockRejectedValueOnce(new Error('no thread for you'));

    await useStore.getState().openThread('root1');

    expect(useStore.getState().activeThreadRootId).toBeNull();
    expect(useToasts.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('resync', () => {
  it('a failed catch-up still flushes the outbox', async () => {
    sync.mockRejectedValueOnce(new Error('still restarting'));
    const flushed = vi.fn(async () => {});
    useStore.setState({ flushOutbox: flushed });

    await useStore.getState().resync();

    expect(flushed).toHaveBeenCalled();
  });
});
