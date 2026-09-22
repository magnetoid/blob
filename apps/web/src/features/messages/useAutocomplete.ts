/** Arrowing through a list under the message field, and picking with Enter or Tab.
 *
 * Shared by the `@` mention list, the `:` emoji list and the `/` command list: the keys
 * are the same, only what is in the list differs. `handleKey` answers whether it
 * consumed the event, so the composer's own bindings only run when no list did.
 */

import { useState, type KeyboardEvent } from "react";

export function useAutocomplete<T>(
  candidates: T[],
  /** What a row is, independent of where it sits. */
  keyOf: (candidate: T) => string,
  onPick: (chosen: T) => void,
  onDismiss?: () => void,
): {
  index: number;
  reset: () => void;
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  // The highlight is held by what it is on, not by where that is. A list can change
  // while it is open without a keystroke — the `@` list re-ranks when a conversation's
  // members or a tag of yours arrive — and a remembered position then sits on another
  // name, which Enter takes while `aria-activedescendant` has not moved. Back to the
  // top only when the highlighted row is gone.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const found =
    activeKey === null ? -1 : candidates.findIndex((c) => keyOf(c) === activeKey);
  const index = found === -1 ? 0 : found;
  const reset = () => setActiveKey(null);

  function highlight(next: number) {
    const candidate = candidates[next];
    if (candidate !== undefined) setActiveKey(keyOf(candidate));
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (candidates.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight((index + 1) % candidates.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight((index - 1 + candidates.length) % candidates.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const chosen = candidates[index];
      if (chosen) onPick(chosen);
      return true;
    }
    if (event.key === "Escape" && onDismiss) {
      onDismiss();
      return true;
    }
    return false;
  }

  return { index, reset, handleKey };
}
