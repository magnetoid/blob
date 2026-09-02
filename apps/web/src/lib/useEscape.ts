/** Escape closes the thing on top, and only the thing on top.
 *
 * Every overlay wants this and each one wrote it slightly differently, on `window`, in the
 * bubble phase. Two of them — CreateChannelDialog and ChannelDetails — carried a comment
 * saying Escape was "bound above" while binding nothing at all.
 *
 * The bug that outlived all of them: the shell listens on `window` too, so *its* handler
 * ran as well. Pressing Escape to dismiss a menu also closed the thread panel behind it,
 * or, with nothing else to close, marked the channel read and destroyed a mark-unread that
 * had just been set. Two bubble listeners on the same node both run — `stopPropagation`
 * from one cannot save the other, which is why every overlay having its own was never
 * going to be enough.
 *
 * So there is one listener, in the capture phase, and a stack. Whichever overlay mounted
 * last is on top and gets the key; propagation stops there, so the shell's own handler
 * only ever sees an Escape that nothing was open to answer. The stack is what makes a
 * dialog opened *over* a menu close the dialog — a single "is a dialog mounted" flag would
 * hand the key to whichever had claimed it first and leave the newer one unclosable.
 */

import { useEffect } from 'react';

type Handler = () => void;

/** Innermost last. Empty means nothing is open and the shell may have the key. */
const open: Handler[] = [];

let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const innermost = open[open.length - 1];
  if (!innermost) return;
  event.stopPropagation();
  innermost();
}

function listenOnce(): void {
  if (listening) return;
  window.addEventListener('keydown', onKeyDown, true);
  listening = true;
}

/**
 * Close this while it is the innermost thing open.
 *
 * `active` is for overlays that stay mounted while closed — `Menu` holds its panel through
 * the exit animation, and a menu on its way out must not still be answering Escape.
 */
export function useEscape(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    listenOnce();
    const handler: Handler = () => onClose();
    open.push(handler);
    return () => {
      const at = open.lastIndexOf(handler);
      if (at !== -1) open.splice(at, 1);
    };
  }, [onClose, active]);
}

/** Whether anything would answer Escape. Exported for tests, not for branching on. */
export function escapeIsClaimed(): boolean {
  return open.length > 0;
}
