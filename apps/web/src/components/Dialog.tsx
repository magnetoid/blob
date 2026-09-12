/** The one modal.
 *
 * Eleven dialogs each carried the same fourteen lines: a fixed backdrop that closed on
 * a click that landed on itself, a focus trap, and an Escape binding — except that two
 * of them had lost the Escape binding under a comment saying it was "bound above", and
 * one bound it on `window` in the bubble phase, the exact bug `lib/useEscape.ts` exists
 * to end. A scaffold copied eleven times is a rule enforced nowhere.
 *
 * Native `<dialog>` with `showModal()` does most of the job in the platform: the top
 * layer, so a dialog opened from inside a transformed, virtualised message row is not
 * trapped in that row's stacking context; `::backdrop`; and everything behind it inert,
 * which is the promise `aria-modal="true"` had been making and a hand-written Tab trap
 * only half kept. The top layer sits above toasts too, which is right — a toast is not
 * a reason to lose the question you were asked.
 *
 * Two things stay ours. Escape goes through the stack in `lib/useEscape.ts`, because a
 * dialog opened over a menu has to close the dialog and the native `cancel` event knows
 * nothing about menus; `cancel` is prevented so the element does not close itself out
 * from under React, which is what unmounts it. And focus goes back where it came from
 * on unmount, because the platform restores it only on `close()`, which nothing calls.
 *
 * `{open && <Dialog/>}` is still the mounting contract: overlays enter, only menus leave
 * (CLAUDE.md), so there is no exit to hold the element open for.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useEscape } from '../lib/useEscape.ts';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  label,
  className,
  onClose,
  children,
}: {
  /** What assistive tech calls the dialog. */
  label: string;
  /** A variant's host class, for its own `::backdrop` and size — `lightbox-host`. */
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // The latest `onClose` without re-registering on the Escape stack each render. A
  // dialog that re-pushed itself on every render would climb back over a menu that had
  // been opened inside it, and Escape would close the wrong thing.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);
  // A dialog closes once. Escape reaches it twice — through the stack, and again as the
  // platform's `cancel` — and a backdrop click followed by Escape must not ask twice.
  const closed = useRef(false);
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    latest.current();
  }, []);

  useEscape(close);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    if (!node.open) node.showModal();
    // The platform's focusing steps put focus on the first control inside — in browsers
    // that run them; not every host does, and a modal that leaves focus behind an inert
    // page is unreachable by keyboard. So it is checked, not assumed. A caller that wants
    // focus somewhere else does so in its own effect, which runs after this one.
    if (!node.contains(document.activeElement)) {
      (node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
    }
    return () => {
      if (node.open) node.close();
      previous?.focus?.();
    };
  }, []);

  return (
    // The keyboard path is Escape, above; a click on the backdrop is the pointer shortcut
    // for it, and the element it lands on is this one.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Escape is the keyboard path
    <dialog
      ref={ref}
      className={className ? `dialog-host ${className}` : 'dialog-host'}
      aria-label={label}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        // A click on `::backdrop` is delivered to the element itself. The content wrapper
        // fills the element, so a click whose target is the element landed outside it.
        if (event.target === event.currentTarget) close();
      }}
    >
      {children}
    </dialog>
  );
}
