/** "Link copied": a word that answers a click, and leaves the way it came.
 *
 * It was `{copied && <span>…</span>}` on a timer, so it cut in and then cut out a moment
 * later in the middle of whatever you had moved on to. Held through its exit by
 * `usePresence`, like a toast: the caller still says only whether it is showing. The
 * consoles' "Saved" notes are the same shape and can use it once their redesign lands.
 *
 * It wears shadcn's muted note — a small muted word on a muted ground — in Tailwind's
 * utilities, which outrank whatever the caller's own legacy class says about the same
 * properties. It is an inline note and not an overlay, so it stays out of the overlay chunk
 * and keeps its own motion: in on `chip-in`, out on `overlay-out`, which travel and scale
 * only by the motion tokens, so under reduced motion it fades and does not move.
 */

import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { usePresence } from '../lib/usePresence.ts';

const NOTE = [
  'rounded-sm bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground',
  'animate-[chip-in_var(--dur-fast)_var(--blob-ease-out)]',
  'data-[state=closed]:animate-[overlay-out_var(--dur-exit)_var(--blob-ease-in)_forwards]',
].join(' ');

export function Confirmation({
  show,
  className,
  children,
  ...rest
}: {
  show: boolean;
  /** The caller's own class — `copied-note` — for where the note sits in its row. */
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'>) {
  const ref = useRef<HTMLSpanElement>(null);
  const { present, state } = usePresence(show, ref);
  if (!present) return null;
  return (
    <span
      {...rest}
      ref={ref}
      className={className ? `${NOTE} ${className}` : NOTE}
      data-state={state}
      inert={state === 'closed' ? true : undefined}
    >
      {children}
    </span>
  );
}
