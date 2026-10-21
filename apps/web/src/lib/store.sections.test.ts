// @vitest-environment happy-dom
/** Saving your sidebar sections: drawn at once, put back if refused, and never undone by
 *  an older answer landing late (M3 · B3). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarSection } from '@blob/shared';

vi.mock('./socket.ts', () => ({
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
vi.mock('./toasts.ts', () => ({ showError: vi.fn(), showToast: vi.fn() }));

const { useStore } = await import('./store.ts');
const { api } = await import('./api.ts');

const A: SidebarSection = { id: 'a', name: 'Clients', channelIds: [], collapsed: false };
const sections = () => useStore.getState().currentUser?.prefs.sidebarSections;

beforeEach(() => {
  useStore.setState({ currentUser: { id: 'me', prefs: { sidebarSections: [] } } as never });
});
afterEach(() => vi.restoreAllMocks());

describe('saving sections', () => {
  it('draws them before the server answers', async () => {
    let answer: (value: unknown) => void = () => undefined;
    vi.spyOn(api.me, 'prefs').mockReturnValue(new Promise((resolve) => (answer = resolve)) as never);
    const saving = useStore.getState().setSidebarSections([A]);
    expect(sections()).toEqual([A]);
    answer({ prefs: { sidebarSections: [A] } });
    await saving;
    expect(sections()).toEqual([A]);
  });

  it('puts them back if the server refuses', async () => {
    vi.spyOn(api.me, 'prefs').mockRejectedValue(new Error('no'));
    await useStore.getState().setSidebarSections([A]);
    expect(sections()).toEqual([]);
  });

  it('keeps the newest save when an older answer lands late', async () => {
    const folded = { ...A, collapsed: true };
    let first: (value: unknown) => void = () => undefined;
    vi.spyOn(api.me, 'prefs')
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)) as never)
      .mockResolvedValueOnce({ prefs: { sidebarSections: [A] } } as never);
    const one = useStore.getState().setSidebarSections([folded]);
    await useStore.getState().setSidebarSections([A]);
    first({ prefs: { sidebarSections: [folded] } });
    await one;
    expect(sections()).toEqual([A]);
  });
});
