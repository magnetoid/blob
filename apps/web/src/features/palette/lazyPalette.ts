/**
 * ⌘K as the first load meets it: a chunk of its own.
 *
 * The palette is shadcn's Command, which is cmdk, and cmdk brings Radix's dialog and its
 * focus and dismissal machinery with it — none of which a first paint needs, since nobody
 * has pressed ⌘K yet. So the module is fetched once (`memoiseImport`), in the same idle
 * moment as the overlay chunk (`preloadAlso`), and Workspace draws it through `lazy()`
 * under a Suspense that shows nothing. A ⌘K pressed before it has arrived starts the fetch
 * itself, and the palette appears when the module does.
 *
 * One opening is drawn without the lazy: the first after the module has arrived. React
 * suspends on a lazy component's first render even when its import has already settled,
 * and holds back the retry that shows it for up to 300ms after the empty fallback was
 * committed, so the preload would still have cost the session's first ⌘K a third of a
 * second. Whether it is here is read once, as the palette mounts, so an open palette never
 * swaps one for the other under somebody typing.
 *
 * `loadPalette` is exported for the tests that open ⌘K through Workspace: awaited at the
 * top of the file, the module is here before the first case.
 */

import { createElement, lazy, useState, type ComponentProps, type ReactElement } from 'react';
import { memoiseImport, preloadAlso } from '../../lib/overlays.ts';

type Palette = typeof import('./CommandPalette.tsx').default;

/** The palette once its module has arrived; never unset, as a loaded module stays loaded. */
let arrived: Palette | null = null;

export const loadPalette = memoiseImport(() =>
  import('./CommandPalette.tsx').then((module) => {
    arrived = module.default;
    return module;
  }),
);
preloadAlso(loadPalette);

const LazyPalette = lazy(loadPalette);

export function CommandPalette(props: ComponentProps<Palette>): ReactElement {
  const [loaded] = useState(() => arrived);
  return loaded ? createElement(loaded, props) : createElement(LazyPalette, props);
}
