/** How long a panel beside a trigger stays drawn: while it is open, and through its exit.
 *
 * About presence, not dismissal: `components/Menu.tsx` and `components/Popover.tsx` both
 * mount their panel from the overlay chunk only while this says so, and a closed panel
 * carries nothing of the chunk. A chunk that failed to load is asked for again on the next
 * opening (`lazyOverlay`).
 */

import { useCallback, useEffect, useState } from 'react';
import { FALLBACK_MS } from './usePresence.ts';

/**
 * Whether the panel is drawn: while it is open and through its exit, and not otherwise.
 *
 * Returns that, and what to call once the exit has played — Base UI says so in
 * `onOpenChangeComplete`. Adjusted during render, React's "adjusting state when a prop
 * changes", so the panel goes in the same commit as the `open` that asked for it; and
 * `FALLBACK_MS` is the floor for an exit nobody reports, since a chunk that never arrived
 * has none to play.
 */
export function useHeldThroughExit(open: boolean): readonly [drawn: boolean, exited: () => void] {
  const [phase, setPhase] = useState({ open, leaving: false });
  if (phase.open !== open) setPhase({ open, leaving: !open });
  const exited = useCallback(() => {
    setPhase((current) => (current.leaving ? { ...current, leaving: false } : current));
  }, []);
  useEffect(() => {
    if (!phase.leaving) return undefined;
    const timer = window.setTimeout(exited, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase.leaving, exited]);
  return [open || phase.leaving, exited] as const;
}
