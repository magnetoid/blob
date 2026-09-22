/** Nothing here, said the same way everywhere.
 *
 * Twenty-one screens each built this from the same three divs, and some had begun to
 * drift: an `aria-hidden` on one mark and not the next, a button with its own margin
 * in one place and none in another. One component, one place for the rule that a mark
 * is decoration and that whatever follows the body sits at the same distance from it.
 */

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { onFirstView } from '../lib/firstView.ts';

export function EmptyState({
  mark,
  title,
  action,
  children,
  className,
  ...rest
}: {
  /** An icon or a glyph. Decoration: the title says what the screen is. */
  mark?: ReactNode;
  title: ReactNode;
  /** A button or two, rendered after the body. */
  action?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  // Decided once, as it mounts: an empty state the app opened onto arrives, and one it
  // was switched to just appears. See `lib/firstView`.
  const [arriving] = useState(onFirstView);
  return (
    <div
      className={className ? `empty-state ${className}` : 'empty-state'}
      data-arriving={arriving ? 'true' : undefined}
      {...rest}
    >
      {mark !== undefined && (
        <div className="empty-state-mark" aria-hidden="true">
          {mark}
        </div>
      )}
      <div className="empty-state-title">{title}</div>
      {children !== undefined && children !== null && children !== false && (
        <div className="empty-state-body">{children}</div>
      )}
      {action}
    </div>
  );
}
