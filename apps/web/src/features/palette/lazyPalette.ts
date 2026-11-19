/**
 * ⌘K as the first load meets it: a chunk of its own.
 *
 * The palette is shadcn's Command, which is cmdk, and cmdk brings Radix's dialog and its
 * focus and dismissal machinery with it — none of which a first paint needs, since nobody
 * has pressed ⌘K yet. So the module is fetched once (`memoiseImport`), in the same idle
 * moment as the overlay chunk (`preloadAlso`), and has normally arrived before the first
 * ⌘K, which then draws the palette in the render that asked for it. A ⌘K pressed before
 * then starts the fetch itself and draws nothing until the module is here.
 *
 * Not `lazy()`, for two reasons. React suspends on a lazy component's first render however
 * settled its import is, and holds back the retry that shows it for up to 300ms after the
 * empty fallback, so the preload would still have cost the session's first ⌘K a third of a
 * second. And a lazy whose import fails throws while rendering, up to the app's error
 * boundary — "Something broke" in place of the whole workspace, for a key press — and keeps
 * the failure, so ⌘K stays dead until a reload. Here a failure is a toast and a closed
 * palette, and the next ⌘K tries again, since `memoiseImport` forgets a failed import. A
 * deploy that replaced the chunk is `lib/staleBuild.ts`'s to explain.
 *
 * Whether the module is here is read once, as the palette mounts, and only goes from absent
 * to here, so an open palette is never swapped for another under somebody typing.
 *
 * `loadPalette` is exported for tests: awaited at the top of a file, the module is here
 * before its first case, as the preload has it here before the first ⌘K.
 */

import {
  createElement,
  useEffect,
  useEffectEvent,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { memoiseImport, preloadAlso } from '../../lib/overlays.ts';
import { showError } from '../../lib/toasts.ts';

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

export function CommandPalette(props: ComponentProps<Palette>): ReactElement | null {
  const [Module, setModule] = useState(() => arrived);

  const failed = useEffectEvent((error: unknown) => {
    console.error('palette failed to load', error);
    showError(new Error('Couldn’t open search. Try again.'));
    props.onClose();
  });

  useEffect(() => {
    if (Module) return undefined;
    let live = true;
    loadPalette().then(
      (module) => {
        if (live) setModule(() => module.default);
      },
      (error: unknown) => {
        if (live) failed(error);
      },
    );
    return () => {
      live = false;
    };
  }, [Module]);

  return Module ? createElement(Module, props) : null;
}
