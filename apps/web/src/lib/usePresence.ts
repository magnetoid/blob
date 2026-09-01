/**
 * Keeping a closing element mounted long enough to animate away.
 *
 * React unmounts on the render that stops returning the element, which is why every
 * overlay here animates in and vanishes out: by the time `open` is false there is
 * nothing left in the DOM to transition. This holds the node for one exit and then
 * lets it go, which is the whole trick — the same contract Radix implements as
 * `data-state`, hand-rolled, because the vocabulary it serves is a fade and 4px.
 *
 * The end of the exit is `animationend`, not a timer, so the duration lives in the
 * stylesheet and nothing here has to agree with it. The timer is only a floor under
 * the cases where that event never comes: an element that is `display: none` at
 * close time, a background tab, a browser that skips the animation, and jsdom-style
 * test environments, which have no animations at all.
 */

import { useEffect, useState, type RefObject } from 'react';

/** Long enough for any exit in the stylesheet, short enough not to strand a node. */
const FALLBACK_MS = 400;

export type PresenceState = 'open' | 'closed';

export interface Presence {
  /** Whether to render at all. Stays true through the exit. */
  present: boolean;
  /** Goes on the element as `data-state`, for CSS to key its exit off. */
  state: PresenceState;
}

export function usePresence(open: boolean, node: RefObject<HTMLElement | null>): Presence {
  const [exiting, setExiting] = useState(false);
  const [previous, setPrevious] = useState(open);

  // React's own "adjusting state when a prop changes" shape: compared and corrected
  // during render, which re-runs this component immediately and lands before the
  // browser paints — where an effect would land a commit later, after a frame in
  // which the panel was neither open nor leaving. The previous value is state rather
  // than a ref because a ref must not be read while rendering.
  if (previous !== open) {
    setPrevious(open);
    setExiting(!open);
  }

  useEffect(() => {
    if (!exiting) return undefined;

    // Still mounted here, so the listener lands on the node about to animate.
    const el = node.current;
    const finish = () => setExiting(false);
    el?.addEventListener('animationend', finish);
    const timer = window.setTimeout(finish, FALLBACK_MS);
    return () => {
      el?.removeEventListener('animationend', finish);
      window.clearTimeout(timer);
    };
  }, [exiting, node]);

  // `state` is a function of `open`, so it needs no storage of its own.
  return { present: open || exiting, state: open ? 'open' : 'closed' };
}
