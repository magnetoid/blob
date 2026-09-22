/** "Ana is typing…", arriving and leaving rather than cutting in and out.
 *
 * Held through its exit by `usePresence`, and holding its sentence with it: the names are
 * already gone by the time the line starts to leave, and "is typing…" with nobody in
 * front of it for 150ms is worse than no exit at all — the same reason the unread jump
 * bar keeps its count. The live region it sits in stays with the caller, mounted whether
 * or not anybody is typing, because a region has to exist before its text changes for
 * the change to be announced.
 */

import { useRef, useState } from 'react';
import { usePresence } from '../../lib/usePresence.ts';

/** Who is typing, in the sentence the line has always used. */
function typingSentence(names: readonly string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

export function TypingIndicator({ names }: { names: readonly string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const open = names.length > 0;
  const { present, state } = usePresence(open, ref);
  const sentence = open ? typingSentence(names) : null;
  const [held, setHeld] = useState(sentence);
  if (sentence !== null && sentence !== held) setHeld(sentence);

  if (!present) return null;

  return (
    <span
      className="typing-dots"
      ref={ref}
      data-state={state}
      inert={state === 'closed' ? true : undefined}
    >
      <i />
      <i />
      <i />
      <span className="typing-text">{sentence ?? held}</span>
    </span>
  );
}
