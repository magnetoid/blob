import { Suspense, lazy, type ComponentType, type JSX } from 'react';
import { loadOverlays, type OverlayModule } from '../lib/overlays.ts';

/** What an overlay whose chunk would not load draws: nothing. */
const drawNothing = () => null;

/**
 * Make a component out of an export of the overlay chunk.
 *
 * The result is drawn like any other component and shows nothing until the chunk is here
 * (`fallback={null}` — an overlay has no business flashing a spinner). It is mounted by
 * the thing that opens it, so a click that lands before the chunk does is not lost: the
 * wrapper holds the person's intent and the overlay catches up with it.
 *
 * A chunk that cannot be fetched costs that overlay and nothing else: it draws nothing,
 * says so once in the console, and the page carries on. That is handled where the load
 * happens, inside the lazy thunk, and not by an error boundary around the overlay — a
 * boundary there would also swallow a render error from the overlay's own content (a
 * dialog body, a menu item a caller passed in), which belongs to the app's `ErrorBoundary`
 * and its report to the admins.
 *
 * `React.lazy` keeps a settled result for good, so the failure also replaces the `lazy`
 * that failed: the next mount — the next time the overlay is opened — gets a fresh one,
 * and with it a fresh attempt (`loadOverlays` forgets its failure). Mount the result when
 * the overlay opens and let it go when it closes.
 */
export function lazyOverlay<P>(pick: (m: OverlayModule) => ComponentType<P>): ComponentType<P> {
  const make = () =>
    lazy(async (): Promise<{ default: ComponentType<P> }> => {
      let overlays: OverlayModule;
      try {
        overlays = await loadOverlays();
      } catch (error) {
        console.error('overlay chunk failed to load', error);
        // Whoever mounts next starts from a lazy that has not failed.
        Lazy = make();
        return { default: drawNothing };
      }
      return { default: pick(overlays) };
    });
  let Lazy = make();

  return function LazyOverlay(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  };
}
