/** Confirming it is you before a sensitive action (M3 · B1).
 *
 * The server refuses minting a token, letting an assistant in, handing out a role or a
 * reset link with 403 `reauth_required` once the session last proved who it is more than
 * a quarter of an hour ago. Rather than every screen that can do one of those learning to
 * ask, `request` in `api.ts` hands the refusal here: whatever is mounted to ask —
 * `ConfirmItsYou` — asks, and the same request goes again once it has been answered.
 */

type Asker = () => Promise<boolean>;

let asker: Asker | null = null;
let pending: Promise<boolean> | null = null;

/** Become the thing that asks. Answers the way to stop being it, for an effect's cleanup. */
export function setAsker(next: Asker): () => void {
  asker = next;
  return () => {
    if (asker !== next) return;
    asker = null;
    // Whatever it was asking is over; the next refusal asks afresh.
    pending = null;
  };
}

/**
 * Ask the person to confirm it is them; true once they have.
 *
 * One question however many requests were refused at the same moment — a page that
 * fires two sensitive calls together must not stack two prompts — and false when nothing
 * is mounted to ask, so a refusal outside the app's screens stays a refusal.
 */
export function confirmItsYou(): Promise<boolean> {
  if (!asker) return Promise.resolve(false);
  pending ??= asker().finally(() => {
    pending = null;
  });
  return pending;
}
