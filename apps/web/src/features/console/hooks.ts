/** The two things every console section does.
 *
 * Before this, each section carried its own copy of "fetch on mount, guard against a
 * stale response, route the failure somewhere visible, reload after a mutation". Eight
 * copies meant eight chances to forget the stale guard — and two of them had.
 */

import { useCallback } from 'react';
import { ApiError } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';

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
  const { data, loading, reload } = useFetch(load, deps, {
    ...options,
    // Console sections show one error line, so the failure becomes a message here.
    onError: (err) => onError(err instanceof ApiError ? err.message : failMessage),
  });
  return { data, loading, reload };
}
