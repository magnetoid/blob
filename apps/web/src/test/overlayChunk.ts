/**
 * Imported for its effect by a test file that opens dialogs: the overlay chunk is here
 * before its first test.
 *
 * In the app the chunk is fetched after first paint (`preloadOverlays`), so by the time
 * somebody opens a dialog it has normally arrived and the dialog is drawn in the render
 * that opened it (`lazyOverlay`'s fast path). A file that imports this gets the same, and
 * its tests can open a dialog and look inside it in the same breath. Only those files pay
 * for it: evaluating the chunk costs a happy-dom file over a second, which across every
 * file was most of the suite's time.
 *
 * A top-level await rather than a `beforeAll`: it runs while the file is collected, which
 * has no per-hook timeout, so a busy machine makes the file slower rather than red — and
 * the time still shows, under `collect`.
 *
 * The chunk arriving late is `Dialog.chunk.test.tsx`'s subject, and never arriving is
 * `lazyOverlay.test.tsx`'s; neither imports this.
 */

import { loadOverlays } from '../lib/overlays.ts';

await loadOverlays();
