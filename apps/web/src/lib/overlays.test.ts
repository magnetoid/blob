// @vitest-environment happy-dom
/**
 * The seam that keeps shadcn's overlays out of the first load.
 *
 * Dialog, menu and popover pull in Base UI's overlay machinery and floating-ui —
 * 76 KB gzipped between them — so they are one dynamic import, started once the page has
 * painted and shared by everything that asks. The cases here are the three ways that
 * could quietly go wrong: asking twice fetches twice, one failed fetch breaks every
 * later open, and "after first paint" becomes "during it".
 *
 * `overlays.ts` keeps its state at module level, so each case loads a fresh copy of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stands in for the barrel, which would otherwise pull all of Base UI into every case.
 * `evaluated` counts how many times the bundler would have fetched the chunk.
 */
const barrel = { evaluated: 0 };
const BARREL = '../components/overlays/index.ts';

async function freshModule() {
  vi.resetModules();
  vi.doMock(BARREL, () => {
    barrel.evaluated += 1;
    return { chunk: 'overlays' };
  });
  return import('./overlays.ts');
}

beforeEach(() => {
  barrel.evaluated = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock(BARREL);
});

describe('loading the overlay chunk', () => {
  it('loads the overlay chunk once however many ask', async () => {
    const { loadOverlays } = await freshModule();

    const first = loadOverlays();
    const second = loadOverlays();
    expect(second).toBe(first);

    await Promise.all([first, second, loadOverlays()]);
    expect(barrel.evaluated).toBe(1);
  });

  it('shares one import between callers that overlap', async () => {
    const { memoiseImport } = await freshModule();
    let release: (value: string) => void = () => {};
    const importer = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const load = memoiseImport(importer);

    const a = load();
    const b = load();
    release('chunk');

    expect(await a).toBe('chunk');
    expect(await b).toBe('chunk');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failed load', async () => {
    const { memoiseImport } = await freshModule();
    const importer = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValue('chunk');
    const load = memoiseImport(importer);

    await expect(load()).rejects.toThrow('Failed to fetch');
    // The rejected promise must not be the answer for ever — a deploy mid-session or a
    // dropped connection would otherwise break every overlay until the page reloads.
    await expect(load()).resolves.toBe('chunk');
    expect(importer).toHaveBeenCalledTimes(2);

    // And once it has loaded, it is kept.
    await load();
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('preloading after first paint', () => {
  it('preloads only once, and only when idle', async () => {
    const idle = vi.fn<(callback: () => void) => number>(() => 1);
    vi.stubGlobal('requestIdleCallback', idle);
    const { preloadOverlays } = await freshModule();

    preloadOverlays();
    preloadOverlays();
    preloadOverlays();

    expect(idle).toHaveBeenCalledTimes(1);
    // Scheduled, not started: nothing is fetched until the browser has a spare moment.
    expect(barrel.evaluated).toBe(0);

    idle.mock.calls[0]![0]();
    await vi.waitFor(() => expect(barrel.evaluated).toBe(1));
  });

  it('falls back to a timer where the browser has no idle callback', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const { preloadOverlays } = await freshModule();

    preloadOverlays();
    preloadOverlays();
    expect(barrel.evaluated).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    // The import itself is real I/O; the timer only decides when it starts.
    await vi.waitFor(() => expect(barrel.evaluated).toBe(1));
  });

  it('survives a failed preload and leaves the retry to the first real use', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { preloadOverlays, loadOverlays } = await freshModule();
      // A dropped connection: the chunk fails once, then is there.
      let attempts = 0;
      vi.doMock(BARREL, () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return { chunk: 'overlays' };
      });

      preloadOverlays();
      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(attempts).toBe(1));
      // Let the rejection travel before looking for anyone complaining about it.
      await new Promise<void>((resolve) => process.nextTick(resolve));
      // Nobody asked for it, so nobody is told: a failed preload is not an error.
      expect(unhandled).not.toHaveBeenCalled();

      // The person opens a menu: that is the retry, and it does not need a reload.
      await expect(loadOverlays()).resolves.toMatchObject({ chunk: 'overlays' });
      expect(attempts).toBe(2);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
