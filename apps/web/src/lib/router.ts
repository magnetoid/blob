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

/**
 * The instance console: what is true of the whole server, across every workspace.
 *
 * Everything here is deliberately *not* workspace-scoped. Members, invitations, channels,
 * apps and webhooks used to live here and did not belong: each one is a question about
 * one workspace, and answering it from a console called "superadmin" made the two jobs
 * look like one. They now live under /workspace, which is where someone running a
 * workspace already goes.
 */
export const ADMIN_SECTIONS = [
  'users',
  'workspaces',
  'app-policy',
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
export const WORKSPACE_SECTIONS = [
  // Yours. First, because everyone has these and only an admin has the rest — and
  // because /settings folded into this page rather than staying a second one that
  // looked different and lived somewhere else.
  'preferences',
  'notifications',
  // The workspace's. Admin-only, enforced in `WorkspaceConsole` rather than here: a
  // route that exists for one person and 404s for another is a route that leaks who is
  // an admin.
  'general',
  'members',
  'invitations',
  'channels',
  'apps',
  'webhooks',
  'appearance',
  'emoji',
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const DEFAULT_WORKSPACE_SECTION: WorkspaceSection = 'general';

/** Where a plain member lands: the part of this page that is theirs. */
export const DEFAULT_MEMBER_SECTION: WorkspaceSection = 'preferences';

/** Sections anyone may open. Everything else on this page needs admin. */
export const PERSONAL_SECTIONS: readonly WorkspaceSection[] = ['preferences', 'notifications'];

export function isPersonalSection(section: WorkspaceSection): boolean {
  return PERSONAL_SECTIONS.includes(section);
}

/**
 * Sections that have a detail page under them, at /admin/:section/:id.
 *
 * An allowlist rather than "any second segment", so a mistyped id on a section that has
 * no detail view lands on the conversation like every other unknown path, instead of
 * rendering a list page that quietly ignores half its URL.
 */
export const ADMIN_DETAIL_SECTIONS: readonly AdminSection[] = ['users'];

/** Workspace sections with a detail page under them, at /workspace/:section/:id. */
export const WORKSPACE_DETAIL_SECTIONS: readonly WorkspaceSection[] = ['members', 'apps'];

/** Where a bare /admin lands. */
export const DEFAULT_ADMIN_SECTION: AdminSection = 'users';

export type Route =
  | { view: 'messages' }
  | { view: 'threads' }
  | { view: 'saved' }
  | { view: 'changelog' }
  /** A permalink to one message. Resolved, then replaced by the conversation. */
  | { view: 'permalink'; messageId: string }
  | { view: 'search' }
  | { view: 'profile' }
  | { view: 'workspace'; section: WorkspaceSection; detailId?: string }
  | { view: 'admin'; section: AdminSection; detailId?: string };

export type View = Route['view'];

/** Unknown paths resolve to the conversation view rather than a dead end. */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';

  if (clean === '/threads') return { view: 'threads' };
  if (clean === '/later') return { view: 'saved' };
  if (clean === '/whats-new') return { view: 'changelog' };
  const permalink = clean.match(/^\/m\/([^/]+)$/);
  if (permalink) return { view: 'permalink', messageId: permalink[1] as string };
  if (clean === '/search') return { view: 'search' };
  if (clean === '/profile') return { view: 'profile' };

  if (clean === '/workspace') return { view: 'workspace', section: DEFAULT_WORKSPACE_SECTION };
  const workspace = clean.match(/^\/workspace\/([^/]+)(?:\/([^/]+))?$/);
  if (workspace) {
    const section = workspace[1] as WorkspaceSection;
    if ((WORKSPACE_SECTIONS as readonly string[]).includes(section)) {
      if (workspace[2] === undefined) return { view: 'workspace', section };
      if (WORKSPACE_DETAIL_SECTIONS.includes(section)) {
        return { view: 'workspace', section, detailId: workspace[2] };
      }
    }
  }

  // Sections that used to live under /admin and are workspace business, not instance
  // business. They were real, linkable URLs — someone has one in a bookmark or a message
  // — so they redirect rather than falling through to the conversation like a typo.
  const MOVED: Record<string, WorkspaceSection> = {
    // Preferences were their own page with their own layout. They are a section of this
    // one now; the old URL still works because people have it in messages.
    '/settings': 'preferences',
    '/admin/settings': 'general',
    '/admin/themes': 'appearance',
    '/admin/people': 'members',
    '/admin/invitations': 'invitations',
    '/admin/channels': 'channels',
    '/admin/apps': 'apps',
    '/admin/webhooks': 'webhooks',
  };
  const moved = MOVED[clean];
  if (moved) return { view: 'workspace', section: moved };

  // A detail page under one of those keeps its id across the move.
  const movedDetail = clean.match(/^\/admin\/(people|apps)\/([^/]+)$/);
  if (movedDetail) {
    return {
      view: 'workspace',
      section: movedDetail[1] === 'people' ? 'members' : 'apps',
      detailId: movedDetail[2],
    };
  }

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
    case 'threads':
      return '/threads';
    case 'saved':
      return '/later';
    case 'changelog':
      return '/whats-new';
    case 'permalink':
      return `/m/${route.messageId}`;
    case 'search':
      return '/search';
    case 'profile':
      return '/profile';
    case 'workspace':
      return route.detailId
        ? `/workspace/${route.section}/${route.detailId}`
        : `/workspace/${route.section}`;
    case 'admin':
      return route.detailId
        ? `/admin/${route.section}/${route.detailId}`
        : `/admin/${route.section}`;
    default:
      return '/';
  }
}

/**
 * Views that are a place you can be, as opposed to a link that resolves and leaves.
 *
 * A permalink carries a message id and is replaced by the conversation as soon as it is
 * followed, so there is no "go to the permalink view" for a button to mean.
 */
export type StableView = Exclude<View, 'permalink'>;

export function pathForView(view: StableView): string {
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
