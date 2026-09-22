/**
 * A picture fades in when its bytes arrive, and never makes anybody wait for one that
 * was already here.
 *
 * The stylesheet holds a revealing image at opacity 0 until it carries `data-loaded`.
 * The attribute is written straight onto the element rather than through React state:
 * nothing re-renders for it, and a re-render cannot take it away because React does not
 * own it. There are two ways to earn it, and they read differently:
 *
 * - `revealIfCached` runs as the element's ref, during the commit, before the first
 *   paint. An image the browser already holds is `complete` by then — the message list
 *   remounts rows as they scroll back into view, and their pictures are all like this —
 *   so it is marked `cached`, which the stylesheet shows at once with no transition.
 * - `revealOnLoad` is the `load` event, for an image that had to be fetched. That one is
 *   marked `true` and fades in over `--dur-open`.
 *
 * `revealOnError` is for pictures whose failure should still be seen — the browser's
 * broken image and its alt text say which file did not load. An avatar does without it:
 * its initials are underneath, and a failed photo leaves them showing.
 */

import type { SyntheticEvent } from 'react';

export function revealIfCached(image: HTMLImageElement | null): void {
  if (image && image.complete && image.naturalWidth > 0 && !image.dataset.loaded) {
    image.dataset.loaded = 'cached';
  }
}

export function revealOnLoad(event: SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  if (!image.dataset.loaded) image.dataset.loaded = 'true';
}

export function revealOnError(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.dataset.loaded = 'failed';
}
