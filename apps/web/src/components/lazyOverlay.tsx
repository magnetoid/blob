import { Suspense, lazy, type ComponentType, type JSX } from 'react';
import { loadOverlays, loadedOverlays, type OverlayModule } from '../lib/overlays.ts';

/** What an overlay whose chunk would not load draws: nothing. */
const drawNothing = () => null;

/**
 * A promise-shaped value that has already settled. `React.lazy` calls `then` on what its
 * loader returns and checks the result before it returns, so a `then` that answers at once
 * is read in the same render — no suspension, no fallback, no commit in between. A real
 * promise, even a resolved one, answers a microtask later.
 */
function settled<T>(value: T): Promise<T> {
  const thenable = {
    then(resolve: (value: T) => unknown) {
      resolve(value);
      return thenable;
    },
  };
  return thenable as unknown as Promise<T>;
}

/**
 * Make a component out of an export of the overlay chunk.
 *
 * The result is drawn like any other component and shows nothing until the chunk is here
 * (`fallback={null}` — an overlay has no business flashing a spinner). It is mounted by
 * the thing that opens it, so a click that lands before the chunk does is not lost: the
 * wrapper holds the person's intent and the overlay catches up with it.
 *
 * Once the chunk is here — the usual case, since the app preloads it after first paint —
 * the overlay is drawn in the render that mounted it, as a statically imported component
 * would be. That is not only quicker: a dialog's body has to be in the document by the
 * time the component that opened it runs its effects, and that is where the forms here
 * focus their first field.
 *
 * A chunk that cannot be fetched costs that overlay and nothing else: it draws nothing,
 * says so once in the console, and the page carries on. That is handled where the load
 * happens, inside the lazy thunk, and not by an error boundary around the overlay — a
 * boundary there would also swallow a render error from the overlay's own content (a
 * dialog body, a menu item a caller passed in), which belongs to the app's `ErrorBoundary`
 * and its report to the admins. In the built app the person is also told, once, that Blob
 * was updated and the page wants a reload — the usual reason a chunk goes missing
 * (`lib/staleBuild.ts`).
 *
 * `React.lazy` keeps a settled result for good, so the failure also replaces the `lazy`
 * that failed: the next mount — the next time the overlay is opened — gets a fresh one,
 * and with it a fresh attempt (`loadOverlays` forgets its failure). Mount the result when
 * the overlay opens and let it go when it closes. A wrapper kept mounted through an outage
 * retries, and logs, once per render of its parent — which is why every caller mounts it
 * on open only.
 */
export function lazyOverlay<P>(pick: (m: OverlayModule) => ComponentType<P>): ComponentType<P> {
  const fetchAndPick = async (): Promise<{ default: ComponentType<P> }> => {
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
  };
  // Not `async` itself: an async function wraps even a settled value in a fresh promise.
  const make = () =>
    lazy((): Promise<{ default: ComponentType<P> }> => {
      const here = loadedOverlays();
      return here ? settled({ default: pick(here) }) : fetchAndPick();
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
