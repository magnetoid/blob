/** Arrowing through a list under the message field, and picking with Enter or Tab.
 *
 * Shared by the `@` mention list, the `:` emoji list and the `/` command list: the keys
 * are the same, only what is in the list differs. `handleKey` answers whether it
 * consumed the event, so the composer's own bindings only run when no list did.
 */

import { useState, type KeyboardEvent } from "react";

export function useAutocomplete<T>(
  candidates: T[],
  onPick: (chosen: T) => void,
  onDismiss?: () => void,
): {
  index: number;
  reset: () => void;
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const [index, setIndex] = useState(0);
  const reset = () => setIndex(0);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (candidates.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => (i + 1) % candidates.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => (i - 1 + candidates.length) % candidates.length);
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
