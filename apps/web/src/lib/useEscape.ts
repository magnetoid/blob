/** Escape closes the thing on top.
 *
 * Every dialog wants this and each one wrote it slightly differently, and two of them —
 * CreateChannelDialog and ChannelDetails — carried a comment saying Escape was "bound
 * above" while binding nothing at all. Pressing Escape in those did not close them: the
 * key reached the shell's handler instead, which closed the thread panel behind the
 * still-open dialog, or, with nothing left to close, marked the channel read and
 * destroyed a mark-unread the person had just set.
 *
 * The capture phase and `stopPropagation` are the load-bearing part. The shell listens on
 * `window` too and, having mounted first, its bubble-phase listener runs *before* a
 * dialog's would. A capture listener on `window` runs before both, so an overlay's Escape
 * stays the overlay's — which is what the two dialogs that did bind it were also getting
 * wrong, more quietly.
 */

import { useEffect } from 'react';

export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}
