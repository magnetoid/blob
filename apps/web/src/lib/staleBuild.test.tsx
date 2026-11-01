// @vitest-environment happy-dom
/**
 * "Blob was updated", said once.
 *
 * In the built app a dynamic import that fails is reported by Vite's preload helper — an
 * event on `window`, `vite:preloadError`, then the error rethrown unless somebody prevented
 * the default (`lib/staleBuild.ts`). Neither the dev server nor vitest has that helper, so
 * the chunk below fails the way the build makes it fail: the event, then the error. What
 * could quietly go wrong is a notice for every overlay that tries, the failure no longer
 * reaching the overlay that asked, and a deploy blamed for a dropped connection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const BARREL = '../components/overlays/index.ts';

/** How often the chunk was asked for, and whether anybody stopped the helper's rethrow. */
const asked = { count: 0, prevented: [] as boolean[] };

/**
 * Fresh copies of everything that keeps state between calls — the notice's "said it", the
 * toasts, the overlay loader's memo — over an overlay chunk a deploy has replaced.
 */
async function withTheChunkGone() {
  vi.resetModules();
  asked.count = 0;
  asked.prevented = [];
  vi.doMock(BARREL, () => {
    asked.count += 1;
    // What Vite's helper does with the rejection, in the order it does it. (vitest hands the
    // importer its own error, with this one as the cause.)
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/overlays-old.js');
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error });
    window.dispatchEvent(event);
    asked.prevented.push(event.defaultPrevented);
    throw error;
  });
  const { installStaleBuildNotice, STALE_BUILD_NOTICE } = await import('./staleBuild.ts');
  const { useToasts } = await import('./toasts.ts');
  const { loadOverlays } = await import('./overlays.ts');
  const { lazyOverlay } = await import('../components/lazyOverlay.tsx');
  const stop = installStaleBuildNotice();
  stops.push(stop);
  const notices = () => useToasts.getState().toasts.filter((t) => t.text === STALE_BUILD_NOTICE);
  return { useToasts, loadOverlays, lazyOverlay, notices };
}

const stops: (() => void)[] = [];

afterEach(() => {
  cleanup();
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.doUnmock(BARREL);
});

describe('a chunk that will not load', () => {
  it('says once that Blob was updated, however many overlays then try', async () => {
    const { useToasts, lazyOverlay, notices } = await withTheChunkGone();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const overlays = () => [1, 2, 3].map(() => lazyOverlay(() => () => null));

    // Three overlays open at once share one attempt, and the person is told.
    const [A, B, C] = overlays();
    const first = render(
      <>
        {A && <A />}
        {B && <B />}
        {C && <C />}
      </>,
    );
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(3));
    expect(asked.count).toBe(1);
    expect(notices()).toHaveLength(1);

    // They read it and close it, and go on opening things. Every opening asks again —
    // and fails again, the old file being gone — but the news is not new.
    useToasts.getState().dismiss(notices()[0]!.id);
    first.unmount();
    const [D, E] = overlays();
    render(
      <>
        {D && <D />}
        {E && <E />}
      </>,
    );
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(5));
    expect(asked.count).toBe(2);
    expect(notices()).toHaveLength(0);
    expect(useToasts.getState().toasts).toHaveLength(0);

    // Nobody stopped the rethrow, so each overlay still heard its own failure: that is
    // what drew nothing and logged.
    expect(asked.prevented).toEqual([false, false]);
    expect(logged).toHaveBeenCalledWith('overlay chunk failed to load', expect.any(Error));
  });

  it('waits while the browser is offline, where the network is the likelier story', async () => {
    const { loadOverlays, notices } = await withTheChunkGone();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await expect(loadOverlays()).rejects.toThrow();
    expect(notices()).toHaveLength(0);

    // Back online and still failing: now it is the build.
    online.mockReturnValue(true);
    await expect(loadOverlays()).rejects.toThrow();
    expect(notices()).toHaveLength(1);
  });
});
