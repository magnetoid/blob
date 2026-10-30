/**
 * Every test file that can render starts with the overlay chunk already here.
 *
 * In the app the chunk is fetched after first paint (`preloadOverlays`), so by the time
 * somebody opens a dialog it has normally arrived and the dialog is drawn in the render
 * that opened it (`lazyOverlay`'s fast path). A test gets the same: one that opens a dialog
 * and looks inside it should not have to know there is a chunk at all. The chunk arriving
 * late, or never, is `lazyOverlay.test.tsx`'s subject; it mocks `lib/overlays.ts`, so
 * this does not reach it.
 *
 * Not under the node environment, where nothing is rendered; and with a generous timeout,
 * because the first import of the chunk in a worker transforms it, and a machine running
 * the whole suite at once can take longer than a hook's usual ten seconds to do that.
 */

import { beforeAll } from 'vitest';
import { loadOverlays } from '../lib/overlays.ts';

if (typeof document !== 'undefined') {
  beforeAll(async () => {
    await loadOverlays();
  }, 60_000);
}
