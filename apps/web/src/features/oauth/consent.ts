/** What the app needs to know about an assistant's sign-in before it draws anything. */

/** `/oauth/authorize` is where an assistant sends the browser (ADR 0029). It is the
 * client's route, not the server's, so a person who is signed out signs in first and the
 * question is still waiting for them afterwards. */
export function isConsentPath(path = window.location.pathname): boolean {
  return path.replace(/\/+$/, '') === '/oauth/authorize';
}

/** Where the browser goes when the page is done. An object so a test can watch the
 * hand-off without the page navigating away underneath it. */
export const leave = {
  to(url: string): void {
    window.location.assign(url);
  },
};

/** The host an address points at, for saying where the answer goes. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
