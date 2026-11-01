/**
 * "Blob was updated": what a person is told when a piece of the client will not load.
 *
 * Every part of the client that is not on the first load — above all the overlay chunk,
 * which every dialog, menu and popover comes from (`lib/overlays.ts`), and the consoles and
 * calls beside it — is a file named for the build it belongs to. A deploy that lands while
 * a page is open replaces those files, so the old page's next import of one fails, and goes
 * on failing: the old file answers 404 however often it is asked for, and an engine that
 * caches a failed module would refuse it even if it came back. The overlay draws nothing and
 * logs. Only a reload picks up the new build, and nothing on the page said so.
 *
 * In the built app every dynamic import goes through Vite's preload helper, which, when the
 * import rejects, dispatches `vite:preloadError` on `window` and then rethrows unless
 * somebody prevented the default (Vite 8's helper, read in the built output). This listens
 * for that and says it once per page: the second failure is the same news. It does not
 * prevent the default, so the import still rejects and whoever made it still hears that it
 * failed — `lazyOverlay` draws nothing and logs, as before. The dev server and vitest have
 * no helper, so nothing is dispatched there.
 */

import { useToasts } from './toasts.ts';

export const STALE_BUILD_NOTICE = 'Blob was updated while this page was open. Reload to carry on.';

let told = false;

function onPreloadError(): void {
  if (told) return;
  // Offline, the network is the likelier story, and the same import may work once it is
  // back: no notice yet, and the one notice is kept for a failure that means it.
  if (navigator.onLine === false) return;
  told = true;
  useToasts.getState().push('info', STALE_BUILD_NOTICE);
}

/** Listen for a chunk that would not load. Returns the way to stop, for the tests. */
export function installStaleBuildNotice(): () => void {
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
