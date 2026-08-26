/** Fetch-on-mount with a stale-response guard.
 *
 * Every screen that loads something on arrival needs the same three things: a request
 * when its deps change, a guard so a slow earlier response cannot paint over a newer
 * one, and somewhere for the failure to go. The hand-rolled copies each kept their own
 * `cancelled` flag, and a forgotten one is invisible until the responses race.
 */

import { useCallback, useEffect, useState } from 'react';

interface Options {
  /** Called with the failure as well as it being returned — for callers that route
   * errors somewhere other than their own render. */
  onError?: (err: Error) => void;
  /** Delay before the request goes out — the search-field case, where a keystroke
   * should not be a request. */
  debounceMs?: number;
}

export function useFetch<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: Options = {},
): { data: T | null; error: Error | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  // Kept, not cleared by a later attempt: the screens that render it treat it as "this
  // view failed", and callers that clear a message do so where their retry starts.
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const { onError, debounceMs = 0 } = options;

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
          if (current) {
            const failure = err instanceof Error ? err : new Error(String(err));
            setError(failure);
            onError?.(failure);
          }
        } finally {
          if (current) setLoading(false);
        }
      })();
    }, debounceMs);

    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `load` (and `onError`) are rebuilt every render by callers that close over local
    // state, so the caller's own `deps` are the honest dependency list. Spreading them
    // is what makes this reusable at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, epoch, debounceMs]);

  const reload = useCallback(() => setEpoch((e) => e + 1), []);
  return { data, error, loading, reload };
}
