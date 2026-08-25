/** One-shot tokens that arrive in the URL, before there is a session to route with.
 *
 * Both are read straight off `location.pathname` rather than through `lib/router.ts`:
 * `parseRoute` maps an unknown path to the conversation view, which is right for a typo
 * and wrong for these — a link from an inbox has to survive being opened by somebody the
 * app has never seen, and in the reset case by somebody who is still signed in.
 *
 * The shapes are contracts with `routers/auth.py`, which builds them from `PUBLIC_URL`.
 * `AuthScreen.test.tsx` and `test_password_reset.py` pin the same two strings from
 * opposite sides, because a drift here fails nowhere and breaks every link in the wild.
 */

/** An invitation email links to /join/<token>. */
export function inviteTokenFromUrl(): string | null {
  return window.location.pathname.match(/^\/join\/(.+)$/)?.[1] ?? null;
}

/** A password-reset email links to /reset/<token>. */
export function resetTokenFromUrl(): string | null {
  return window.location.pathname.match(/^\/reset\/(.+)$/)?.[1] ?? null;
}
