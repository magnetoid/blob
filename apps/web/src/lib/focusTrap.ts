/**
 * Keep Tab inside a dialog, and put focus back where it came from.
 *
 * Every dialog here declares `aria-modal="true"`, which is a promise to assistive
 * tech that the rest of the page is inert. Without a trap the promise was false: Tab
 * walked straight out into the page behind, and closing the dialog dropped focus on
 * <body>, stranding a keyboard user at the top of the document.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap focus within `node` until the returned cleanup runs; restores focus to
 * whatever held it before. Call from an effect: `useEffect(() => trapFocus(ref.current), [])`.
 */
export function trapFocus(node: HTMLElement | null): () => void {
  if (!node) return () => {};
  const previous = document.activeElement as HTMLElement | null;

  // Focus the first control so the dialog is where keys go immediately — unless
  // something inside (an autoFocus input) already claimed it.
  if (!node.contains(document.activeElement)) {
    const first = node.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node).focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !node) return;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', onKeyDown);
  return () => {
    node.removeEventListener('keydown', onKeyDown);
    // The opener may be gone (a menu item that closed with its menu); body focus is
    // the honest fallback rather than a guess.
    previous?.focus?.();
  };
}
