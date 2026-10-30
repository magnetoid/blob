/**
 * The one door to the overlay chunk.
 *
 * shadcn's dialog, alert dialog, dropdown menu and popover stand on Base UI's overlay
 * machinery and floating-ui, which is some 75 KB gzipped on top of a first load that
 * has 40 KB of room. So none of them is imported statically. `components/overlays/index.ts`
 * is the barrel that chunk is built from; this module is the only place that imports it,
 * `components/lazyOverlay.tsx` is how a component waits for it, and
 * `scripts/bundle-budget.mjs` fails the build if Base UI's overlay code ever turns up in
 * the first load by another road.
 */

/** What the barrel exports, which is what `lazyOverlay`'s `pick` chooses from. */
export type OverlayModule = typeof import('../components/overlays/index.ts');

/**
 * Wrap an import so it happens once, and so a failure is not remembered.
 *
 * A rejected import must not stay the answer, or one dropped connection would break every
 * overlay until the page was reloaded. The memo is cleared as the rejection passes
 * through, so the next caller tries again and the one after that shares its attempt.
 * That helps with a transient network failure, and only in an engine that fetches a
 * failed module again (WHATWG html#10327; not every browser does). It does not help with
 * a deploy that replaced the chunk mid-session: the old file is gone, its URL answers 404
 * to every attempt, and only a reload picks up the new build.
 *
 * Exported for the test; the app uses `loadOverlays`.
 */
export function memoiseImport<T>(importer: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= importer().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/** The overlay chunk, fetched the first time anybody needs it and shared after that. */
export const loadOverlays: () => Promise<OverlayModule> = memoiseImport(
  () => import('../components/overlays/index.ts'),
);

/**
 * Past this a page that is never quiet — a busy channel redraws all day — still gets its
 * overlays loaded, rather than leaving the first menu to pay for it.
 */
const IDLE_DEADLINE_MS = 4000;

let scheduled = false;

/**
 * Start fetching the overlay chunk once the page has nothing better to do.
 *
 * Without this the first menu or dialog of every session would wait for the network. With
 * it the chunk is normally there before anybody has reached for one, and the first load
 * did not pay for it. Idempotent: the app calls it once after mount and further calls do
 * nothing. A failure is swallowed here — nobody has asked for an overlay yet — and the
 * first real use will try again (`memoiseImport`).
 */
export function preloadOverlays(): void {
  if (scheduled) return;
  scheduled = true;

  const start = () => {
    loadOverlays().catch(() => {});
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(start, { timeout: IDLE_DEADLINE_MS });
  } else {
    // Safari has no idle callback. A timer still defers the import past the current task,
    // which is all the first paint needs.
    setTimeout(start, 1);
  }
}
