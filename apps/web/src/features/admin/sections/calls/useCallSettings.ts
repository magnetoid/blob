/** A workspace's call settings, read live from the store rather than fetched here.
 *
 * `Workspace`'s mount calls `loadCalls()`, which resolves through the same
 * `load_calls()` the admin GET does, and every save broadcasts a `calls.settings` frame
 * that the store applies on its own (`store.ts`'s `calls.settings` case) — so the store's
 * copy is never behind what a GET would have returned. Reading it here instead of
 * fetching our own copy is what keeps two admins with this page open, or one admin in two
 * tabs, from having a save in one leave the other showing the stale value until it
 * remounts (R37). `callsLoaded` gates the read so a cold load of this page shows nothing
 * rather than presenting the built-in defaults as though they were the workspace's own.
 *
 * `save` still goes through `useAdminAction` for its error handling, but with no reload:
 * the broadcast is the refresh, and asking again after a save it already triggered would
 * be the same redundant fetch this hook exists to drop.
 */

import { useCallback } from 'react';
import { api, type CallSettings } from '../../../../lib/api.ts';
import { useStore } from '../../../../lib/store.ts';
import { useAdminAction } from '../../../console/hooks.ts';

/** Nothing to reload: `calls.settings` reaches every listener, including this one. */
const noReload = () => {};

export function useCallSettings(onError: (message: string | null) => void) {
  const loaded = useStore((s) => s.callsLoaded);
  const stored = useStore((s) => s.callSettings);
  const settings = loaded ? stored : null;

  const act = useAdminAction(onError, noReload);
  const save = useCallback(
    (next: CallSettings) =>
      act(async () => {
        await api.admin.setCallSettings(next);
      }),
    [act],
  );
  return { settings, save };
}
