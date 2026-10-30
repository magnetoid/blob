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

/** One thing open. `close` is null for an overlay that answers the key itself. */
interface Layer {
  close: Handler | null;
}

/** Innermost last. Empty means nothing is open and the shell may have the key. */
const open: Layer[] = [];

let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const innermost = open[open.length - 1];
  if (!innermost) return;
  if (innermost.close === null) {
    // A Base UI dialog on top. Its own listener, on `document`, closes it and stops the key
    // there, before it can bubble back up to the shell's; all the stack does is hold the top,
    // so nothing opened before it hears this. The exception is the Escape that only ends an
    // input method's composition: Base UI leaves that one alone, so nothing would stop it.
    // Where the key says so (`isComposing`) it stops here; Safari's says false, because its
    // `compositionend` comes first, and the dialog's popup stops that one itself
    // (`DialogImpl`), since the field being composed in is inside it.
    if (!event.isComposing) return;
    event.stopPropagation();
    return;
  }
  event.stopPropagation();
  // And the browser's own answer to the key, which comes after every handler: a close
  // request, sent to whichever native modal is on top *by then* — which need not be the
  // thing that just answered. The key has been answered here; nothing else should answer
  // it again.
  event.preventDefault();
  innermost.close();
}

function listenOnce(): void {
  if (listening) return;
  window.addEventListener('keydown', onKeyDown, true);
  listening = true;
}

function useLayer(close: Handler | null, active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    listenOnce();
    const layer: Layer = { close };
    open.push(layer);
    return () => {
      const at = open.lastIndexOf(layer);
      if (at !== -1) open.splice(at, 1);
    };
  }, [close, active]);
}

/**
 * Close this while it is the innermost thing open.
 *
 * `active` is for overlays that stay mounted while closed — `Menu` holds its panel through
 * the exit animation, and a menu on its way out must not still be answering Escape.
 */
export function useEscape(onClose: () => void, active = true): void {
  useLayer(onClose, active);
}

/**
 * Hold the top of the stack for an overlay whose own Escape handling closes it.
 *
 * A Base UI dialog answers Escape itself, and has to: that is what runs its exit, hands
 * focus back and lets a dialog nested in it close first. What it does not know about is
 * everything on this stack — a panel or a menu opened before it, which would otherwise
 * be innermost and take the key out from under it. So it takes a place here too, one that
 * closes nothing: while it is on top the key goes on to its own listener untouched, and
 * nothing beneath it hears that Escape. One key, one layer.
 */
export function useEscapeLayer(active = true): void {
  useLayer(null, active);
}
