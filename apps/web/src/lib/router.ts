/** The client's URL.
 *
 * Four top-level views and the seven admin sections are real paths, so a screen can be
 * linked, bookmarked and reloaded into — the way Slack's admin is a URL you can send
 * someone. Small enough to hand-roll: there are no nested layouts, no loaders and no
 * data-router features here, and the three runtime dependencies stay three.
 *
 * The server already cooperates: `SinglePageApp` answers any non-API path with
 * index.html, so /admin/people survives a hard refresh.
 */

import { useEffect, useState } from 'react';

export const ADMIN_SECTIONS = [
  'people',
  'invitations',
  'channels',
  'apps',
  'themes',
  'audit',
  'settings',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export type Route =
  | { view: 'messages' }
  | { view: 'search' }
  | { view: 'settings' }
  | { view: 'admin'; section: AdminSection };

export type View = Route['view'];

/** Unknown paths resolve to the conversation view rather than a dead end. */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';

  if (clean === '/search') return { view: 'search' };
  if (clean === '/settings') return { view: 'settings' };

  if (clean === '/admin') return { view: 'admin', section: 'people' };
  const admin = clean.match(/^\/admin\/([^/]+)$/);
  if (admin) {
    const section = admin[1] as AdminSection;
    if ((ADMIN_SECTIONS as readonly string[]).includes(section)) {
      return { view: 'admin', section };
    }
  }

  return { view: 'messages' };
}

/** The canonical path for a route. Round-trips with `parseRoute`. */
export function pathForRoute(route: Route): string {
  switch (route.view) {
    case 'search':
      return '/search';
    case 'settings':
      return '/settings';
    case 'admin':
      return `/admin/${route.section}`;
    default:
      return '/';
  }
}

export function pathForView(view: View): string {
  return pathForRoute(view === 'admin' ? { view, section: 'people' } : { view });
}

function currentPath(): string {
  return window.location.pathname;
}

/**
 * pushState does not notify anyone, so navigation dispatches the same event a Back
 * button would. One listener then serves both, and history stays a single source.
 */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === currentPath()) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return path;
}
