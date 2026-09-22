/** "Link copied": a word that answers a click, and leaves the way it came.
 *
 * It was `{copied && <span>…</span>}` on a timer, so it cut in and then cut out a moment
 * later in the middle of whatever you had moved on to. Held through its exit by
 * `usePresence`, like a toast: the caller still says only whether it is showing. The
 * consoles' "Saved" notes are the same shape and can use it once their redesign lands.
 */

import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { usePresence } from '../lib/usePresence.ts';

export function Confirmation({
  show,
  className,
  children,
  ...rest
}: {
  show: boolean;
  /** The note's own look — `copied-note`, `pref-hint` — beside the motion. */
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
      className={className ? `confirmation ${className}` : 'confirmation'}
      data-state={state}
      inert={state === 'closed' ? true : undefined}
    >
      {children}
    </span>
  );
}
