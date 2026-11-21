/**
 * A module kept out of the first load, fetched once and shared by everything that waits
 * for it.
 *
 * ⌘K's palette and every menu or popover that owns its trigger (`components/lazyTrigger.tsx`)
 * stand on code the first paint does not need — cmdk, Base UI's overlay machinery — so each
 * is a module of its own. This is what they have in common. The import happens once,
 * whoever asks first (`memoiseImport`), and it is registered to start in the same idle
 * moment as the overlay chunk (`preloadAlso`), so it has normally arrived before anybody
 * reaches for it. Once it is here it is `current()` for the life of the page, and whoever
 * subscribed while it was on its way is told, once, as it lands.
 *
 * A failed import is forgotten as it passes (`memoiseImport`), so the next load asks the
 * network again. Chromium and Firefox fetch it again; WebKit keeps a module that failed for
 * the life of the page and answers the same failure without asking, so there only a reload
 * helps. That is why a load a person asked for (`loadForPerson`) says, when it fails,
 * "reload", which works in every engine, and never "try again", which would be wrong in one
 * engine in three — and why, offline, where a reload would lose the page, it says that
 * instead. It says it once per attempt, logged and toasted, however many presses were
 * waiting on that attempt: a person pressing again because nothing happened is the same
 * failure, not a new one. A load nobody asked for — the preload — fails quietly, as the
 * overlay chunk's own does. A deploy that replaced the module mid-session is
 * `lib/staleBuild.ts`'s to explain.
 */

import { memoiseImport, preloadAlso } from './overlays.ts';
import { showError } from './toasts.ts';

/** What a person is told when the module behind `name` will not load. */
export function failureMessage(name: string, online: boolean = navigator.onLine !== false): string {
  return online
    ? `Couldn’t open ${name}. Reload the page to try again.`
    : `Couldn’t open ${name} while you’re offline.`;
}

export interface LazyModule<T> {
  /** The module once it has arrived, and null until then; never unset once it has. */
  current(): T | null;
  /** Hear once, as the module arrives; returns the way to stop listening. */
  subscribe(onArrive: () => void): () => void;
  /** The module, fetched once and shared; a failure is forgotten, so the next load asks again. */
  load(): Promise<T>;
  /** `load()` for a person who asked: a failure is logged and toasted once per attempt. */
  loadForPerson(): Promise<T>;
}

/**
 * Wrap `importer` — a literal `import()`, so the bundler splits it off — as a module that
 * arrives once. `name` is what a person was opening, for the toast when it will not load:
 * "search", "this menu".
 */
export function lazyModule<T>(importer: () => Promise<T>, name: string): LazyModule<T> {
  let arrived: T | null = null;
  /** Whoever is waiting to hear that it has. */
  const waiting = new Set<() => void>();

  const load = memoiseImport(() =>
    importer().then((module) => {
      arrived = module;
      // A copy, since hearing may unsubscribe; and nobody is left to tell after this.
      const told = [...waiting];
      waiting.clear();
      for (const hear of told) hear();
      return module;
    }),
  );
  preloadAlso(load);

  /** The attempt a person last joined: its failure is said once, not once per press. */
  let reported: Promise<T> | null = null;
  const loadForPerson = (): Promise<T> => {
    const attempt = load();
    if (attempt !== reported) {
      reported = attempt;
      attempt.catch((error: unknown) => {
        console.error(`module for ${name} failed to load`, error);
        showError(new Error(failureMessage(name)));
      });
    }
    return attempt;
  };

  return {
    current: () => arrived,
    subscribe(onArrive) {
      waiting.add(onArrive);
      return () => {
        waiting.delete(onArrive);
      };
    },
    load,
    loadForPerson,
  };
}
