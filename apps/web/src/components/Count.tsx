/** A number that ticks when it changes in front of you, and sits still when it is drawn.
 *
 * The span is keyed by its value, so React replaces it when the number moves and the
 * replacement plays `count-tick` — the mechanism the reaction count has used since the
 * small-motions pass. What that version could not tell apart is a number *changing* from
 * a number *mounting*: the message list is virtualised, so every row mounts again when it
 * scrolls into view and on every channel switch, and every count on it ticked each time.
 * `data-changed` is set once the value has moved at all since this mounted — in either
 * direction, so taking a reaction back ticks as surely as adding one did — which is
 * exactly the difference between somebody reacting and somebody scrolling. A caller whose
 * number can change *subject* under it (a panel that switches threads) keys this by the
 * subject, so a different thing's count arrives rather than ticks.
 *
 * `format` is for a count that is part of a phrase — "3 replies" — which ticks as one
 * piece of text rather than as a digit beside a word, and reads as one to a finder.
 */

import { useState } from 'react';

export function Count({
  value,
  className,
  format,
}: {
  value: number;
  className?: string;
  format?: (value: number) => string;
}) {
  // Adjusted during render, the way `usePresence` adjusts its own: an effect would land
  // a commit late, after a frame drawn with the new number and no tick.
  const [seen, setSeen] = useState({ value, changed: false });
  if (seen.value !== value) setSeen({ value, changed: true });
  return (
    <span key={value} className={className} data-changed={seen.changed ? 'true' : undefined}>
      {format ? format(value) : value}
    </span>
  );
}
