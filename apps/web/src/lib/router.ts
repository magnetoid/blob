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
  'webhooks',
  'feedback',
  'audit',
  'health',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/**
 * Setting up the workspace is its own page, not a section of the server console.
 *
 * The two answer different questions and belong to different people: /workspace is
 * "what is this workspace like" — its name, how it looks, how people get in — and
 * /admin is "is the server behaving" — health, audit, apps, the people table. Both were
 * one screen, with workspace setup reduced to a single name field buried three clicks
 * inside the operational console.
 *
 * The split also happens to be the boundary multi-tenancy needs, so drawing it now costs
 * a route and saves an untangling later.
 */
export const WORKSPACE_SECTIONS = ['general', 'appearance'] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const DEFAULT_WORKSPACE_SECTION: WorkspaceSection = 'general';

/**
 * Sections that have a detail page under them, at /admin/:section/:id.
 *
 * An allowlist rather than "any second segment", so a mistyped id on a section that has
 * no detail view lands on the conversation like every other unknown path, instead of
 * rendering a list page that quietly ignores half its URL.
 */
export const ADMIN_DETAIL_SECTIONS: readonly AdminSection[] = ['people', 'apps'];

/** Where a bare /admin lands. */
export const DEFAULT_ADMIN_SECTION: AdminSection = 'people';

export type Route =
  | { view: 'messages' }
  | { view: 'search' }
  | { view: 'settings' }
  | { view: 'profile' }
  | { view: 'workspace'; section: WorkspaceSection }
  | { view: 'admin'; section: AdminSection; detailId?: string };

export type View = Route['view'];

/** Unknown paths resolve to the conversation view rather than a dead end. */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';

  if (clean === '/search') return { view: 'search' };
  if (clean === '/settings') return { view: 'settings' };
  if (clean === '/profile') return { view: 'profile' };

  if (clean === '/workspace') return { view: 'workspace', section: DEFAULT_WORKSPACE_SECTION };
  const workspace = clean.match(/^\/workspace\/([^/]+)$/);
  if (workspace) {
    const section = workspace[1] as WorkspaceSection;
    if ((WORKSPACE_SECTIONS as readonly string[]).includes(section)) {
      return { view: 'workspace', section };
    }
  }

  // These two moved to /workspace when workspace setup stopped being a section of the
  // operational console. They were real, linkable URLs, so they redirect rather than
  // falling through to the conversation like a typo.
  if (clean === '/admin/settings') return { view: 'workspace', section: 'general' };
  if (clean === '/admin/themes') return { view: 'workspace', section: 'appearance' };

  if (clean === '/admin') return { view: 'admin', section: DEFAULT_ADMIN_SECTION };
  const admin = clean.match(/^\/admin\/([^/]+)(?:\/([^/]+))?$/);
  if (admin) {
    const section = admin[1] as AdminSection;
    if ((ADMIN_SECTIONS as readonly string[]).includes(section)) {
      if (admin[2] === undefined) return { view: 'admin', section };
      if (ADMIN_DETAIL_SECTIONS.includes(section)) {
        return { view: 'admin', section, detailId: admin[2] };
      }
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
    case 'profile':
      return '/profile';
    case 'workspace':
      return `/workspace/${route.section}`;
    case 'admin':
      return route.detailId
        ? `/admin/${route.section}/${route.detailId}`
        : `/admin/${route.section}`;
    default:
      return '/';
  }
}

export function pathForView(view: View): string {
  if (view === 'admin') return pathForRoute({ view, section: DEFAULT_ADMIN_SECTION });
  if (view === 'workspace') return pathForRoute({ view, section: DEFAULT_WORKSPACE_SECTION });
  return pathForRoute({ view });
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
