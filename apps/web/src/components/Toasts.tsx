/** The stack of transient notices. Rendered once, near the root.
 *
 * Wearing shadcn's toast — a card with a border, a shadow and a radius — in Tailwind's
 * utilities, and still Blob's underneath: the store (`lib/toasts.ts`), the live region,
 * and the hold through each toast's exit are as they were. It stays in the first load, and
 * is not Base UI's toast from the overlay chunk, because the region has to be in the
 * document before its first announcement (below). The class names that are left —
 * `toast-stack`, `toast`, `toast-text` — style nothing; they name the parts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToasts, type Toast } from '../lib/toasts.ts';
import { usePresence } from '../lib/usePresence.ts';

/**
 * Fixed at the bottom of the screen, centred, above every dialog (`--z-toast`): a failure
 * notice must survive an open modal. It catches no clicks itself, so an empty one costs
 * nothing; each toast takes them back.
 */
const STACK =
  'toast-stack pointer-events-none fixed bottom-4 left-1/2 z-(--z-toast) flex -translate-x-1/2 flex-col gap-2';

/**
 * shadcn's toast surface. The edge says which kind it is — a failure in the destructive
 * colour, a notice in Blob's accent — so an info toast does not read as a failure whose
 * colour did not load. It rises in from below on `toast-in` and leaves on `overlay-out`,
 * which travel only by the motion tokens, so under reduced motion it fades and does not
 * move; and a leaving toast catches no clicks.
 */
const TOAST = [
  'toast pointer-events-auto flex max-w-[420px] items-center gap-2.5 rounded-lg border bg-popover px-3 py-2.5',
  'text-popover-foreground shadow-lg',
  'data-[kind=error]:border-destructive data-[kind=info]:border-(--blob-accent-border)',
  'animate-[toast-in_var(--dur-open)_var(--blob-ease-out)]',
  'data-[state=closed]:pointer-events-none',
  'data-[state=closed]:animate-[overlay-out_var(--dur-exit)_var(--blob-ease-in)_forwards]',
].join(' ');

/** The notice itself, at the size shadcn's toast sets it. */
const TEXT = 'toast-text text-sm leading-snug';

/** Quiet until it is pointed at, and pressed like every other control here. */
const DISMISS = [
  'shrink-0 cursor-pointer rounded-sm px-1 py-0.5 text-lg leading-none text-muted-foreground',
  'transition-[color,scale] duration-(--dur-fast) hover:text-foreground active:scale-(--motion-press)',
].join(' ');

/**
 * What is on screen: the store's toasts, plus any that have been taken out of it and are
 * still animating away. Ids count up, so sorting by id is the order they arrived in — a
 * toast on its way out keeps its place in the stack instead of hopping to the end of it
 * for the length of its exit.
 *
 * A held toast whose text is back in the store is dropped instead, which is the one place
 * the exit could have changed what a screen reader hears. `role="status"` is atomic, so
 * anything added to the region re-reads the whole of it — a copy held for its animation
 * beside its own replacement would be announced as the same sentence twice. The store
 * collapses a repeated failure into one notice; this is that guarantee, kept across the
 * 150ms the old one is still leaving.
 */
function merge(shown: Toast[], live: Toast[]): Toast[] {
  const leaving = shown.filter(
    (held) => !live.some((t) => t.id === held.id || t.text === held.text),
  );
  if (leaving.length === 0) return live;
  return [...live, ...leaving].sort((a, b) => a.id - b.id);
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  // The store forgets a toast the moment it is dismissed or expires, and React drops a
  // node on the render that stops returning it — which together are why a toast used to
  // vanish rather than leave. This keeps the dismissed one's text until it has finished
  // animating, and is reconciled *during* render, the same shape (and for the same
  // reason) as usePresence's own: an effect lands a commit later, after a frame in which
  // the toast was already gone from the DOM and had nothing left to animate.
  const [shown, setShown] = useState(toasts);
  const [previous, setPrevious] = useState(toasts);
  if (previous !== toasts) {
    setPrevious(toasts);
    setShown((current) => merge(current, toasts));
  }

  // An item reports itself gone once its exit has finished. The same array back when
  // there is nothing to drop, so a repeated report cannot cause a render.
  const forget = useCallback((id: number) => {
    setShown((current) =>
      current.some((t) => t.id === id) ? current.filter((t) => t.id !== id) : current,
    );
  }, []);

  // The region stays mounted even with nothing in it, and that is the whole point: a
  // live region has to exist *before* its content changes for the change to be
  // announced. Returning null until the first toast created the region and its text in
  // the same commit, which screen readers commonly say nothing about — so the one
  // channel the app uses to report a failure was the one a reader could not hear. The
  // stack is `position: fixed` and `pointer-events: none`, so an empty one costs no
  // layout and catches no clicks.
  return (
    // `status`+polite: announced by screen readers without stealing focus, which is
    // the right weight for "that didn't work" — an alert would interrupt typing.
    <div className={STACK} role="status" aria-live="polite">
      {shown.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          open={toasts.some((t) => t.id === toast.id)}
          onDismiss={dismiss}
          onGone={forget}
        />
      ))}
    </div>
  );
}

interface ItemProps {
  toast: Toast;
  /** Whether the store still has it. False starts the exit; it does not end the toast. */
  open: boolean;
  onDismiss: (id: number) => void;
  /** Its exit is over and the parent can stop holding its text. */
  onGone: (id: number) => void;
}

/** One notice, held through its exit by the hook `Menu` uses. A component of its own
 *  because that takes a ref and a hook, and neither can live inside a `.map`. */
function ToastItem({ toast, open, onDismiss, onGone }: ItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { present, state } = usePresence(open, ref);

  useEffect(() => {
    if (!present) onGone(toast.id);
  }, [present, onGone, toast.id]);

  if (!present) return null;

  return (
    // `data-state` is what the exit is keyed off; it is set on the node that is already
    // there rather than on a new one, so a leaving toast is not announced a second time.
    <div ref={ref} className={TOAST} data-slot="toast" data-kind={toast.kind} data-state={state}>
      <span className={TEXT}>{toast.text}</span>
      {/* Gone the moment the toast starts leaving. `pointer-events: none` stops the
          pointer and nothing else — a leaving toast would still be in the tab order,
          offering a control that dismisses what is already dismissed. Removing the
          button rather than marking the toast `inert`, because `inert` takes the text
          out of the live region, and removal is not what a live region announces. */}
      {state === 'open' && (
        <button
          type="button"
          className={DISMISS}
          aria-label="Dismiss notice"
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      )}
    </div>
  );
}
