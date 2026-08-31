/** Arrows walk the conversation.
 *
 * A message row is a tab stop because that is the only route a keyboard has to react,
 * reply and the ••• menu — a plain-text message contains nothing focusable. In a channel
 * of six hundred messages that makes Tab six hundred presses to reach the composer: the
 * affordance that made the actions usable made the page unusable. So arrows move between
 * rows and Tab is left to move *past* the list.
 *
 * A module rather than a closure in the row so it can be tested against the thing that
 * actually runs, and so six hundred rendered rows share one function rather than each
 * closing over their own.
 */

export function moveFocusBetweenMessages(event: {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault: () => void;
}): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  // Only when the row itself has focus: inside the editor or the ••• menu the arrows
  // already mean something, and stealing them there would be worse than not having this.
  if (event.target !== event.currentTarget) return;

  const row = event.currentTarget as HTMLElement | null;
  if (!row) return;
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-id]'),
  ).filter((candidate) => candidate.tabIndex === 0);
  const here = rows.indexOf(row);
  if (here < 0) return;

  // No wrapping. Going from the newest message to the oldest is a jump of six hundred
  // rows dressed up as a keypress.
  const next = rows[here + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;

  event.preventDefault();
  next.focus();
  // The list is virtualized, so the row just focused may be at the very edge of the
  // rendered window; bring it fully into view rather than half-clipped.
  next.scrollIntoView({ block: 'nearest' });
}
