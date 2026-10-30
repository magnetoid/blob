// @vitest-environment happy-dom
/**
 * An overlay that is not in the first load has to arrive without breaking anything.
 *
 * `lazyOverlay` is what the dialog, menu and popover wrappers are made with. Three
 * promises: nothing of the overlay shows until its chunk is here and everything does the
 * moment it is; a chunk that never arrives costs the overlay and nothing else; and the
 * next time somebody opens it, the import is tried again — `React.lazy` remembers a
 * rejection for good, so that is not free.
 */
import { Suspense, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { lazyOverlay } from './lazyOverlay.tsx';
import { loadOverlays, type OverlayModule } from '../lib/overlays.ts';

vi.mock('../lib/overlays.ts', () => ({ loadOverlays: vi.fn() }));
const load = vi.mocked(loadOverlays);

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}
/** The shape `pick` sees, which is the barrel's — the test's own module stands in for it. */
const fakeModule = { Greeting } as unknown as OverlayModule;
const pickGreeting = (m: OverlayModule) =>
  (m as unknown as { Greeting: ComponentType<{ name: string }> }).Greeting;

/** A promise settled from outside, standing in for a chunk still on the wire. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  load.mockReset();
  // React reports a caught render error through console.error too; the cases below
  // count only the overlay's own line.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

const ours = () =>
  consoleError.mock.calls.filter((call) => String(call[0]).includes('overlay chunk'));

describe('lazyOverlay', () => {
  it('renders the overlay once its chunk arrives', async () => {
    const chunk = deferred<OverlayModule>();
    load.mockReturnValue(chunk.promise);
    const Overlay = lazyOverlay<{ name: string }>(pickGreeting);

    render(
      <>
        <p>the page</p>
        <Overlay name="Ada" />
      </>,
    );
    // The chunk is still on the wire: the page is up, the overlay is not, and the
    // placeholder is nothing — an overlay has no business flashing a spinner.
    expect(screen.getByText('the page')).toBeTruthy();
    expect(screen.queryByText('Hello Ada')).toBeNull();

    await act(async () => chunk.resolve(fakeModule));
    expect(screen.getByText('Hello Ada')).toBeTruthy();
    expect(screen.getByText('the page')).toBeTruthy();
  });

  it('opens with the props it had when its chunk lands', async () => {
    // The click that arrives before the chunk does: the wrapper is already mounted with
    // what the person asked for, and the overlay simply catches up.
    const chunk = deferred<OverlayModule>();
    load.mockReturnValue(chunk.promise);
    const Overlay = lazyOverlay<{ name: string }>(pickGreeting);

    const { rerender } = render(<Overlay name="Ada" />);
    rerender(<Overlay name="Grace" />);
    await act(async () => chunk.resolve(fakeModule));

    expect(screen.getByText('Hello Grace')).toBeTruthy();
  });

  it('renders nothing and keeps the page up when the chunk fails', async () => {
    load.mockRejectedValue(new Error('Failed to fetch dynamically imported module'));
    const Overlay = lazyOverlay<{ name: string }>(pickGreeting);

    render(
      <>
        <p>the page</p>
        <Overlay name="Ada" />
      </>,
    );
    await act(async () => {});

    expect(screen.getByText('the page')).toBeTruthy();
    expect(screen.queryByText('Hello Ada')).toBeNull();
    expect(ours()).toHaveLength(1);
  });

  it('tries the import again the next time the overlay is opened', async () => {
    load
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(fakeModule);
    const Overlay = lazyOverlay<{ name: string }>(pickGreeting);

    const first = render(<Overlay name="Ada" />);
    await act(async () => {});
    expect(screen.queryByText('Hello Ada')).toBeNull();
    first.unmount();

    // Opened again: a fresh mount, a fresh attempt, and this time it lands.
    render(
      <Suspense fallback={null}>
        <Overlay name="Ada" />
      </Suspense>,
    );
    await act(async () => {});
    expect(screen.getByText('Hello Ada')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(ours()).toHaveLength(1);
  });
});
