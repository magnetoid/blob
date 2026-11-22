// @vitest-environment happy-dom
/**
 * A module kept out of the first load, as everything that waits for one sees it.
 *
 * `lazyModule` is the loader under ⌘K's palette and under every menu or popover that owns
 * its trigger (`components/lazyTrigger.tsx`). Its promises: one fetch however many ask,
 * the preload among them; whoever is waiting hears once that it is here; and a load that a
 * person asked for and that failed says so once, in words that work in every engine —
 * reload, since WebKit keeps a module that failed for the life of the page — or that it is
 * offline, where a reload would lose the page. A failure is not the answer for good: the
 * next load asks again.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { lazyModule } from './lazyModule.ts';
import { preloadAlso } from './overlays.ts';
import { useToasts } from './toasts.ts';

// The registration is the case's to look at; nothing here runs the app's preload.
vi.mock('./overlays.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./overlays.ts')>()),
  preloadAlso: vi.fn(),
}));

/** What the module stands for: anything an import hands back. */
const MODULE = { default: 'the palette' };

/** One fetch, still on the wire: the case lands it or drops it. */
type Attempt<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void };

/** An import the test holds: each call is one fetch, landed or dropped by the case. */
function heldImport() {
  const attempts: Attempt<typeof MODULE>[] = [];
  const importer = vi.fn(
    () =>
      new Promise<typeof MODULE>((resolve, reject) => {
        attempts.push({ resolve, reject });
      }),
  );
  return {
    importer,
    release: () => attempts.at(-1)!.resolve(MODULE),
    fail: () =>
      attempts.at(-1)!.reject(new TypeError('Failed to fetch dynamically imported module')),
  };
}

const toastTexts = () => useToasts.getState().toasts.map((toast) => toast.text);

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.mocked(preloadAlso).mockReset();
  useToasts.setState({ toasts: [] });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('lazyModule', () => {
  it('loads once for every caller', async () => {
    const { importer, release } = heldImport();
    const search = lazyModule(importer, 'search');
    // Registered to be fetched beside the overlay chunk, and nothing fetched by that alone.
    expect(preloadAlso).toHaveBeenCalledTimes(1);
    expect(importer).not.toHaveBeenCalled();
    const preload = vi.mocked(preloadAlso).mock.calls[0]![0];

    const asked = [preload(), search.load(), search.loadForPerson(), search.load()];
    expect(importer).toHaveBeenCalledTimes(1);
    expect(search.current()).toBeNull();

    release();
    for (const module of await Promise.all(asked)) expect(module).toBe(MODULE);
    expect(search.current()).toBe(MODULE);
    // And once it is here, asking again fetches nothing.
    expect(await search.load()).toBe(MODULE);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers once when the module arrives', async () => {
    const { importer, release } = heldImport();
    const search = lazyModule(importer, 'search');
    /** What each subscriber found when it was told. */
    const heard: unknown[] = [];
    search.subscribe(() => heard.push(search.current()));
    const gone = vi.fn();
    const unsubscribe = search.subscribe(gone);
    unsubscribe();

    const loading = search.load();
    await Promise.resolve();
    expect(heard).toEqual([]);

    release();
    await loading;
    // Told as it arrived, with the module already there to read.
    expect(heard).toEqual([MODULE]);
    expect(gone).not.toHaveBeenCalled();

    await search.load();
    expect(heard).toEqual([MODULE]);
  });

  it('asks for a reload, once per attempt, when a load a person asked for fails', async () => {
    const { importer, fail } = heldImport();
    const search = lazyModule(importer, 'search');

    // Pressed twice because nothing happened the first time: one fetch, two asks.
    const first = search.loadForPerson();
    const second = search.loadForPerson();
    expect(importer).toHaveBeenCalledTimes(1);
    fail();
    await expect(first).rejects.toThrow('Failed to fetch');
    await expect(second).rejects.toThrow('Failed to fetch');

    expect(toastTexts()).toEqual(['Couldn’t open search. Reload the page to try again.']);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('search'), expect.any(Error));
  });

  it('says it is offline instead when the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { importer, fail } = heldImport();
    const search = lazyModule(importer, 'search');

    const asked = search.loadForPerson();
    fail();
    await expect(asked).rejects.toThrow('Failed to fetch');

    expect(toastTexts()).toEqual(['Couldn’t open search while you’re offline.']);
  });

  it('asks again on the next load after a failure', async () => {
    const { importer, release, fail } = heldImport();
    const search = lazyModule(importer, 'search');

    const first = search.loadForPerson();
    fail();
    await expect(first).rejects.toThrow('Failed to fetch');
    useToasts.setState({ toasts: [] });

    // A fresh attempt, not the failure replayed, and its failure is said again.
    const second = search.loadForPerson();
    expect(importer).toHaveBeenCalledTimes(2);
    fail();
    await expect(second).rejects.toThrow('Failed to fetch');
    expect(toastTexts()).toEqual(['Couldn’t open search. Reload the page to try again.']);
    expect(consoleError).toHaveBeenCalledTimes(2);

    // And one that lands is the answer from then on.
    const third = search.load();
    expect(importer).toHaveBeenCalledTimes(3);
    release();
    expect(await third).toBe(MODULE);
    expect(search.current()).toBe(MODULE);
  });
});
