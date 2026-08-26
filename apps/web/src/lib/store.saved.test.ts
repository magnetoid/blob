// @vitest-environment happy-dom
/** Putting a message aside, on this side of the wire.
 *
 * `toggleSaved` has to be optimistic and it has to roll back, which is a stronger
 * obligation than it looks. Saving broadcasts nothing — the list is one person's and an
 * event would have a single subscriber already holding the response — so there is no
 * `message.updated` coming along afterwards to correct the row. The Set in this store
 * *is* what the menu reads, which makes it the only copy and the rollback the only
 * thing standing between a failed request and a label that lies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.fn(async () => ({ ok: true as const }));

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    api: { ...actual.api, messages: { ...actual.api.messages, save } },
  };
});

vi.mock('./socket.ts', () => ({
  socket: { send: vi.fn(), sendControl: vi.fn(), connect: vi.fn(), close: vi.fn(), onEvent: vi.fn(), onStatus: vi.fn() },
}));

const { useStore } = await import('./store.ts');

const saved = () => [...useStore.getState().savedMessageIds];

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ savedMessageIds: new Set<string>() });
});

describe('toggleSaved', () => {
  it('saves one that is not, and tells the server so', async () => {
    await useStore.getState().toggleSaved('m1');

    expect(saved()).toEqual(['m1']);
    expect(save).toHaveBeenCalledWith('m1', true);
  });

  it('unsaves one that is', async () => {
    useStore.setState({ savedMessageIds: new Set(['m1']) });
    await useStore.getState().toggleSaved('m1');

    expect(saved()).toEqual([]);
    expect(save).toHaveBeenCalledWith('m1', false);
  });

  it('shows the change before the request finishes', async () => {
    let release = () => {};
    save.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ ok: true as const }))),
    );

    const pending = useStore.getState().toggleSaved('m1');
    // The menu closes on the tap. Waiting for a round trip to redraw the label would
    // make a hit feel like a miss on a slow connection.
    expect(saved()).toEqual(['m1']);
    release();
    await pending;
    expect(saved()).toEqual(['m1']);
  });

  it('puts it back when the save fails', async () => {
    save.mockRejectedValueOnce(new Error('offline'));

    await expect(useStore.getState().toggleSaved('m1')).rejects.toThrow();
    // Nothing arrives later to correct this. Leaving it hopeful means the menu says
    // "Remove from later" about a message the server never heard of.
    expect(saved()).toEqual([]);
  });

  it('puts it back when the unsave fails', async () => {
    useStore.setState({ savedMessageIds: new Set(['m1']) });
    save.mockRejectedValueOnce(new Error('offline'));

    await expect(useStore.getState().toggleSaved('m1')).rejects.toThrow();
    expect(saved()).toEqual(['m1']);
  });

  it('leaves everything else alone', async () => {
    useStore.setState({ savedMessageIds: new Set(['m1', 'm2']) });
    await useStore.getState().toggleSaved('m2');

    expect(saved()).toEqual(['m1']);
  });
});
