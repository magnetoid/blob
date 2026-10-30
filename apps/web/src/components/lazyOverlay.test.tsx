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
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { reportClientError } from '../lib/clientErrors.ts';
import { loadOverlays, loadedOverlays, type OverlayModule } from '../lib/overlays.ts';

vi.mock('../lib/overlays.ts', () => ({ loadOverlays: vi.fn(), loadedOverlays: vi.fn() }));
vi.mock('../lib/clientErrors.ts', () => ({ reportClientError: vi.fn() }));
const load = vi.mocked(loadOverlays);
const loaded = vi.mocked(loadedOverlays);

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
  // Not here yet, unless a case says otherwise.
  loaded.mockReset().mockReturnValue(null);
  vi.mocked(reportClientError).mockReset();
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

  it('draws in the render that opened it when its chunk is already here', () => {
    // The normal case once the app has preloaded the chunk: a dialog's body has to be in
    // the document when the component that opened it runs its effects, and a lazy that
    // suspended even for a microtask would miss that.
    loaded.mockReturnValue(fakeModule);
    const Overlay = lazyOverlay<{ name: string }>(pickGreeting);

    render(<Overlay name="Ada" />);

    expect(screen.getByText('Hello Ada')).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
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

  it('leaves a render error inside the overlay to the app’s error boundary', async () => {
    // The chunk arrives fine; what is thrown is the overlay's own content — a dialog body
    // or a menu item a caller passed in. That is a bug to be reported, not a chunk that
    // failed to load, so it must reach the boundary that reports it.
    function Broken(): never {
      throw new Error('the body threw');
    }
    load.mockResolvedValue({ Broken } as unknown as OverlayModule);
    const Overlay = lazyOverlay<object>(
      (m) => (m as unknown as { Broken: ComponentType<object> }).Broken,
    );

    render(
      <ErrorBoundary>
        <p>the page</p>
        <Overlay />
      </ErrorBoundary>,
    );
    await act(async () => {});

    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'the body threw' }),
    );
    expect(ours()).toHaveLength(0);
  });
});
