/** The dropdown behind a trigger the caller renders.
 *
 * Three menus grew three private copies of the same dismissal wiring, and no two got
 * it quite alike. This is the house contract, once: dismissed by a click *outside*
 * the panel — decided by `ref.contains`, never "any click" — or by Escape, with both
 * suspended while the caller has a dialog up, because a dialog rendered beside the
 * panel is "outside" by that test and would be unmounted by the very click that
 * asked for it. See the ChannelMenu trap note in `.torsor/active/context.md`.
 *
 * Escape goes through `lib/useEscape`, which owns one capture-phase listener and a stack,
 * so the key stops here instead of also reaching the shell.
 *
 * The trigger stays with the caller: what opens a menu is one-off (an avatar, a
 * workspace name, a channel title) and what closes one is not. The panel keeps the
 * caller's own class so each menu's existing CSS continues to key on its own name.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { usePresence } from '../lib/usePresence.ts';
import { useEscape } from '../lib/useEscape.ts';

/** Every focusable menu item, in DOM order. Disabled ones cannot take focus, so
 *  offering them to the arrows would strand the roving focus on the way past. */
const ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Goes on the panel element itself, where each caller's CSS expects it. */
  className?: string;
  /** True while the caller has a dialog up: dismissing would unmount the dialog too. */
  suspendDismiss?: boolean;
  children: ReactNode;
}

export function Menu({ open, onClose, className, suspendDismiss = false, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Whatever held focus when the menu opened — the trigger, wherever the browser left
  // it. Focus goes back there on close so a keyboard user is not stranded on <body>.
  const openerRef = useRef<HTMLElement | null>(null);
  const { present, state } = usePresence(open, panelRef);

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      // Restore only when closing left focus nowhere — the panel that held it is
      // already gone when this cleanup runs. A click that closed the menu by landing
      // on another control has given that control focus, and keeps it.
      const active = document.activeElement;
      if (active === null || active === document.body) openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [open]);

  // Escape through the shared stack rather than a listener of its own: two bubble
  // listeners on `window` both run, so a menu closing itself did not stop the shell
  // from also acting on the key — closing the thread behind it, or marking the channel
  // read. See `lib/useEscape`.
  useEscape(onClose, open && !suspendDismiss);

  useEffect(() => {
    if (!open || suspendDismiss) return undefined;
    // Capture phase, so a click that lands on another control closes this first
    // rather than leaving two panels open.
    const onClick = (event: globalThis.MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      const inPanel = active instanceof HTMLElement && panel.contains(active);
      // A form control inside the panel owns its own arrows: Up and Down change the
      // option of a <select> and step the segment of a date field. Steering focus to
      // the next menu item instead makes those controls unusable by keyboard, which is
      // exactly what the schedule menu's repeat select and time field would hit.
      if (
        inPanel &&
        (active instanceof HTMLSelectElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLInputElement)
      ) {
        return;
      }
      // Steer only focus the menu plausibly owns: inside the panel, on the element
      // that opened it, or nowhere (Safari does not focus a clicked button). Arrows
      // pressed in a composer behind an open menu keep moving the caret there.
      if (!inPanel && active !== openerRef.current && active !== document.body && active !== null) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
      if (items.length === 0) return;
      event.preventDefault();
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      let next: number;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
      else next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, suspendDismiss, onClose]);

  // Held through its exit rather than dropped on the render that closes it, so the
  // panel can animate away. Every effect above keys on `open`, not on presence: a
  // menu on its way out must stop answering Escape and arrow keys the moment it is
  // asked to close, or it would still be steering focus while it faded.
  if (!present) return null;

  return (
    <div className={className} role="menu" ref={panelRef} data-state={state}>
      {children}
    </div>
  );
}
