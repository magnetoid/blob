/** The two things every console section does.
 *
 * Before this, each section carried its own copy of "fetch on mount, guard against a
 * stale response, route the failure somewhere visible, reload after a mutation". Eight
 * copies meant eight chances to forget the stale guard — and two of them had.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api.ts';

/**
 * Wraps a mutation so a failure is a message rather than a dead click, and so the list
 * it changed is reloaded from the server rather than patched by hand.
 */
export function useAdminAction(
  onError: (message: string | null) => void,
  reload: () => void,
): (run: () => Promise<unknown>) => Promise<void> {
  return useCallback(
    async (run: () => Promise<unknown>) => {
      onError(null);
      try {
        await run();
        reload();
      } catch (err) {
        onError(err instanceof ApiError ? err.message : 'That did not work.');
      }
    },
    [onError, reload],
  );
}

/**
 * Load something for a console page.
 *
 * `deps` behaves like an effect's dependency list. `debounceMs` covers the search
 * field case, where a keystroke should not be a request. The stale guard is the point:
 * without it, typing "ann" then deleting to "a" can leave the slower "ann" response
 * painting the screen, and the list no longer matches the box above it.
 */
export function useAdminData<T>(
  load: () => Promise<T>,
  deps: unknown[],
  onError: (message: string | null) => void,
  failMessage: string,
  options: { debounceMs?: number } = {},
): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const { debounceMs = 0 } = options;

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      // Inside the timer rather than beside it: a debounced reload should not flash
      // "Loading…" on every keystroke, only once the request is actually going out.
      setLoading(true);
      void (async () => {
        try {
          const result = await load();
          if (current) setData(result);
        } catch (err) {
          if (current) onError(err instanceof ApiError ? err.message : failMessage);
        } finally {
          if (current) setLoading(false);
        }
      })();
    }, debounceMs);

    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `load` is rebuilt every render by callers that close over local state, so the
    // caller's own `deps` are the honest dependency list. Spreading them is what makes
    // this reusable at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, epoch, debounceMs]);

  const reload = useCallback(() => setEpoch((e) => e + 1), []);
  return { data, loading, reload };
}
