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

/** One thing open. `close` is null for an overlay that answers the key itself, and `early`
 *  is what answers for such an overlay until it can. */
interface Layer {
  close: Handler | null;
  early: EarlyAnswer | null;
}

/** For an overlay that is open before it is drawn — see `useEscapeLayer`. */
export interface EarlyAnswer {
  /** Whether it is drawn, with its own listener in the document. Asked as each key arrives. */
  drawn: () => boolean;
  /** What an Escape pressed before then does. */
  close: Handler;
}

/** Innermost last. Empty means nothing is open and the shell may have the key. */
const open: Layer[] = [];

let listening = false;

/** What answers this Escape for a layer: a handler, or null to leave it to the overlay. */
function answerFor(layer: Layer, event: KeyboardEvent): Handler | null {
  if (layer.close) return layer.close;
  // Not drawn yet, so nothing of the overlay's own is listening and the layer answers for
  // it — except the Escape that only ends a composition, which the overlay would leave alone.
  if (layer.early && !layer.early.drawn() && !event.isComposing) return layer.early.close;
  return null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const innermost = open[open.length - 1];
  if (!innermost) return;
  const close = answerFor(innermost, event);
  if (close === null) {
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
  // And its default, so the browser does nothing more with the key either. It has been
  // answered here, and one Escape is answered once.
  event.preventDefault();
  close();
}

function listenOnce(): void {
  if (listening) return;
  window.addEventListener('keydown', onKeyDown, true);
  listening = true;
}

function useLayer(close: Handler | null, active: boolean, early: EarlyAnswer | null = null): void {
  useEffect(() => {
    if (!active) return undefined;
    listenOnce();
    const layer: Layer = { close, early };
    open.push(layer);
    return () => {
      const at = open.lastIndexOf(layer);
      if (at !== -1) open.splice(at, 1);
    };
  }, [close, early, active]);
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
 *
 * `early` is for an overlay that is open before it is drawn: a dialog is opened by
 * first-load code (`DialogPresence`) and drawn by the overlay chunk, which may still be on
 * its way. Until `early.drawn()` says it is there, an Escape is the dialog's all the same —
 * stopped here, default prevented and handed to `early.close` — where letting it through
 * would hand it to nobody, and it would reach the shell. Pass the same object on every
 * render: a new one re-registers the layer, which puts it back on top.
 */
export function useEscapeLayer(active = true, early: EarlyAnswer | null = null): void {
  useLayer(null, active, early);
}
