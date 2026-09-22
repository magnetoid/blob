/**
 * Whether the app is still showing the first view it opened on, untouched.
 *
 * An empty state arrives with a small entrance when the app opens onto one — a reload on
 * an empty Later list, a permalink that did not resolve — because then it is the first
 * thing on the screen and worth the beat. After the first move it simply appears: every
 * view after that is one somebody switched to, and a transition on a switch is what the
 * design layer refuses.
 *
 * A move is a pushed route, the Back and Forward buttons, or anything done on the page at
 * all — a press or a key. That last is what covers a switch *inside* a view: a Later tab,
 * a Files or Tasks filter, Browse's "Include archived", a query typed into Help. None of
 * those changes the route, and an empty state one of them brings on was asked for, not
 * opened onto. Replacing the route is not a move: the app does that to itself on arrival
 * (canonicalising the address, opening #general).
 *
 * Its own module rather than a corner of `router.ts`, because a good many suites mock the
 * router whole and render an empty state, and an export missing from their mock would
 * fail them for a question that has nothing to do with what they test.
 */

let moved = false;

export function onFirstView(): boolean {
  return !moved;
}

export function leftFirstView(): void {
  moved = true;
}

if (typeof window !== 'undefined') {
  // The router dispatches a popstate of its own after every navigation, so that one
  // listener serves both; only the browser's is trusted, and that one is a move.
  window.addEventListener('popstate', (event) => {
    if (event.isTrusted) moved = true;
  });
  // Capture, so no handler below can hide the first touch; once, because after it there
  // is nothing left to learn.
  window.addEventListener('pointerdown', leftFirstView, { capture: true, once: true });
  window.addEventListener('keydown', leftFirstView, { capture: true, once: true });
}
