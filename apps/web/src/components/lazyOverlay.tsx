import {
  Component,
  Suspense,
  lazy,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';
import { loadOverlays, type OverlayModule } from '../lib/overlays.ts';

/** Renders nothing once the chunk has failed to load, and says so once. */
class OverlayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('overlay chunk failed to load', error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Make a component out of an export of the overlay chunk.
 *
 * The result is drawn like any other component and shows nothing until the chunk is here
 * (`fallback={null}` — an overlay has no business flashing a spinner). It is mounted by
 * the thing that opens it, so a click that lands before the chunk does is not lost: the
 * wrapper holds the person's intent and the overlay catches up with it.
 *
 * A chunk that cannot be fetched costs that overlay and nothing else. The boundary around
 * it renders nothing, says so once in the console, and the page carries on. `React.lazy`
 * keeps a rejection for good, so the next mount — the next time the overlay is opened —
 * gets a fresh `lazy`, and with it a fresh attempt (`loadOverlays` forgets its failure).
 * So mount the result when the overlay opens and let it go when it closes: one kept
 * mounted through a failure stays blank until something remounts it.
 */
export function lazyOverlay<P>(pick: (m: OverlayModule) => ComponentType<P>): ComponentType<P> {
  const make = () =>
    lazy(async () => {
      try {
        return { default: pick(await loadOverlays()) };
      } catch (error) {
        // Whoever mounts next starts from a lazy that has not failed.
        Lazy = make();
        throw error;
      }
    });
  let Lazy = make();

  return function LazyOverlay(props: P) {
    return (
      <OverlayBoundary>
        <Suspense fallback={null}>
          <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
        </Suspense>
      </OverlayBoundary>
    );
  };
}
