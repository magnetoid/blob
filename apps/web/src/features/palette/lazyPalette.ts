/**
 * ⌘K as the first load meets it: a chunk of its own.
 *
 * The palette is shadcn's Command, which is cmdk, and cmdk brings Radix's dialog and its
 * focus and dismissal machinery with it — none of which a first paint needs, since nobody
 * has pressed ⌘K yet. So the module is fetched once, in the same idle moment as the
 * overlay chunk (`lib/lazyModule.ts`), and has normally arrived before the first ⌘K, which
 * then draws the palette in the render that asked for it. A ⌘K pressed before then starts
 * the fetch itself and draws nothing until the module is here.
 *
 * Not `lazy()`, for two reasons. React suspends on a lazy component's first render however
 * settled its import is, and holds back the retry that shows it for up to 300ms after the
 * empty fallback, so the preload would still have cost the session's first ⌘K a third of a
 * second. And a lazy whose import fails throws while rendering, up to the app's error
 * boundary — "Something broke" in place of the whole workspace, for a key press — and keeps
 * the failure, so ⌘K stays dead until a reload. Here a failure is a toast and a closed
 * palette, and the next ⌘K asks for the module again, since `lazyModule` forgets a failed
 * import. Chromium and Firefox fetch it again; WebKit keeps a module that failed for the
 * life of the page and answers the same failure without asking the network, so there only a
 * reload helps. `lib/staleBuild.ts`'s "Reload to carry on" says so once per page, as the idle
 * preload fails, and is gone six seconds later — long before a ⌘K, as a rule. So the
 * palette's own toast says it: reload, which works in every engine, never "try again", which
 * would be wrong in one engine in three. Offline, a reload would lose the page, so it says
 * that instead. The words are `lazyModule`'s (`failureMessage`), shared with every menu and
 * popover that waits on a module of its own; the palette logs and says them itself, as it
 * closes the palette-to-be.
 *
 * Whether the module is here is read once, as the palette mounts, and only goes from absent
 * to here, so an open palette is never swapped for another under somebody typing.
 *
 * While it is on its way the palette is open and not drawn, and two keys meant for it
 * would go elsewhere. Escape is answered by its place on the Escape stack
 * (`lib/useEscape.ts`), taken as it mounts, so it closes the palette-to-be rather than the
 * panel opened before it; once the palette is drawn its dialog holds the place instead.
 * And Enter goes nowhere, because focus is still where ⌘K was pressed — the composer, as
 * often as not, where the half-typed query would be sent as a message. Every other key
 * goes where focus is: nothing is buffered for the palette.
 *
 * `loadPalette` is exported for tests: awaited at the top of a file, the module is here
 * before its first case, as the preload has it here before the first ⌘K.
 */

import {
  createElement,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { failureMessage, lazyModule } from '../../lib/lazyModule.ts';
import { showError } from '../../lib/toasts.ts';
import { useEscape } from '../../lib/useEscape.ts';

type Palette = typeof import('./CommandPalette.tsx').default;

/** The palette's module: fetched once, beside the overlay chunk. */
const palette = lazyModule(() => import('./CommandPalette.tsx'), 'search');

/** What the toast says when the palette's module will not load. */
export const PALETTE_FAILED = failureMessage('search', true);
export const PALETTE_OFFLINE = failureMessage('search', false);

export const loadPalette = palette.load;

export function CommandPalette(props: ComponentProps<Palette>): ReactElement | null {
  const [Module, setModule] = useState(() => palette.current()?.default ?? null);
  const pending = Module === null;

  // Closing is the caller's latest word, through a function that stays the same: a new one
  // on every render of the caller would put the layer back on top of anything opened since.
  const onClose = useRef(props.onClose);
  useLayoutEffect(() => {
    onClose.current = props.onClose;
  });
  const [close] = useState(() => () => onClose.current());
  useEscape(close, pending);

  useEffect(() => {
    if (!pending) return undefined;
    // On the document, in the capture phase: before React's root, where the composer's own
    // handler would hear it, and before the browser breaks the line.
    const swallowEnter = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', swallowEnter, true);
    return () => document.removeEventListener('keydown', swallowEnter, true);
  }, [pending]);

  const failed = useEffectEvent((error: unknown) => {
    console.error('palette failed to load', error);
    showError(new Error(failureMessage('search')));
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
