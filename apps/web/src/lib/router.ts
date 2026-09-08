/** The client's URL.
 *
 * Two consoles, not three. /settings is yours — theme, notifications, the agents
 * that run on your machine. /admin is this server: its name, who is in it, the
 * channels, the apps, and whether the machine is healthy. Blob is one open-source
 * server, not a grid of workspaces, so those jobs share a page rather than pretending
 * to be two products.
 *
 * The server already cooperates: `SinglePageApp` answers any non-API path with
 * index.html, so /admin/members survives a hard refresh.
 */

import { useEffect, useState } from 'react';

/**
 * Everything an admin configures on this server.
 *
 * Used to be split: /workspace for the name and the people, /admin for the machine.
 * That split was the multi-tenant idea leaking into the UI. One page now.
 */
export const ADMIN_SECTIONS = [
  'general',
  'appearance',
  'members',
  'groups',
  'invitations',
  'channels',
  'emoji',
  'apps',
  'webhooks',
  'users',
  'app-policy',
  'feedback',
  'audit',
  'logs',
  'health',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Yours. A private page, because these are not the server's business. */
export const SETTINGS_SECTIONS = [
  'preferences',
  'notifications',
  'my-agents',
  'assistants',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'preferences';

/** Sections that have a detail page under them, at /admin/:section/:id. */
export const ADMIN_DETAIL_SECTIONS: readonly AdminSection[] = [
  'users',
  'members',
  'groups',
  'apps',
];

/** Where a bare /admin lands. */
export const DEFAULT_ADMIN_SECTION: AdminSection = 'general';

export type Route =
  | { view: 'home' }
  | { view: 'messages' }
  /** One conversation, addressable: /c/:channelId, optionally with an open thread. */
  | { view: 'channel'; channelId: string; threadRootId?: string }
  | { view: 'threads' }
  | { view: 'activity' }
  | { view: 'tasks' }
  | { view: 'saved' }
  | { view: 'browse' }
  | { view: 'scheduled' }
  | { view: 'changelog' }
  /** The guide: what everything on this screen is, and how to use it. */
  | { view: 'help' }
  /** A permalink to one message. Resolved, then replaced by the conversation. */
  | { view: 'permalink'; messageId: string }
  | { view: 'search' }
  | { view: 'profile' }
  | { view: 'settings'; section: SettingsSection }
  | { view: 'admin'; section: AdminSection; detailId?: string };

export type View = Route['view'];

/** Old /workspace URLs that now live under /settings. */
const LEGACY_SETTINGS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS);

/** Old /workspace URLs that now live under /admin. */
const LEGACY_ADMIN: ReadonlySet<string> = new Set([
  'general',
  'appearance',
  'members',
  'groups',
  'invitations',
  'channels',
  'emoji',
  'apps',
  'webhooks',
]);

const LEGACY_ADMIN_DETAIL: ReadonlySet<string> = new Set(['members', 'groups', 'apps']);

/** Unknown paths resolve to the conversation view rather than a dead end. */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';

  if (clean === '/' || clean === '/home') return { view: 'home' };
  const channel = clean.match(/^\/c\/([^/]+)(?:\/t\/([^/]+))?$/);
  if (channel) {
    return channel[2] !== undefined
      ? { view: 'channel', channelId: channel[1] as string, threadRootId: channel[2] }
      : { view: 'channel', channelId: channel[1] as string };
  }
  if (clean === '/threads') return { view: 'threads' };
  if (clean === '/activity') return { view: 'activity' };
  if (clean === '/tasks') return { view: 'tasks' };
  if (clean === '/later') return { view: 'saved' };
  if (clean === '/channels') return { view: 'browse' };
  if (clean === '/scheduled') return { view: 'scheduled' };
  if (clean === '/whats-new') return { view: 'changelog' };
  if (clean === '/help') return { view: 'help' };
  const permalink = clean.match(/^\/m\/([^/]+)$/);
  if (permalink) return { view: 'permalink', messageId: permalink[1] as string };
  if (clean === '/search') return { view: 'search' };
  if (clean === '/profile') return { view: 'profile' };

  if (clean === '/settings') return { view: 'settings', section: DEFAULT_SETTINGS_SECTION };
  const settings = clean.match(/^\/settings\/([^/]+)$/);
  if (settings && LEGACY_SETTINGS.has(settings[1] as string)) {
    return { view: 'settings', section: settings[1] as SettingsSection };
  }

  // /workspace used to be the third console. Bookmarks and help links still arrive;
  // they resolve to the page that actually owns the work now.
  if (clean === '/workspace') return { view: 'admin', section: DEFAULT_ADMIN_SECTION };
  const legacyWorkspace = clean.match(/^\/workspace\/([^/]+)(?:\/([^/]+))?$/);
  if (legacyWorkspace) {
    const section = legacyWorkspace[1] as string;
    if (LEGACY_SETTINGS.has(section) && legacyWorkspace[2] === undefined) {
      return { view: 'settings', section: section as SettingsSection };
    }
    if (LEGACY_ADMIN.has(section)) {
      if (legacyWorkspace[2] === undefined) {
        return { view: 'admin', section: section as AdminSection };
      }
      if (LEGACY_ADMIN_DETAIL.has(section)) {
        return {
          view: 'admin',
          section: section as AdminSection,
          detailId: legacyWorkspace[2],
        };
      }
    }
  }

  // Names that predate even /workspace. Real, linkable URLs — they redirect.
  if (clean === '/admin/settings') return { view: 'admin', section: 'general' };
  if (clean === '/admin/themes') return { view: 'admin', section: 'appearance' };
  if (clean === '/admin/people') return { view: 'admin', section: 'members' };
  if (clean === '/admin/workspaces') return { view: 'admin', section: DEFAULT_ADMIN_SECTION };
  const peopleDetail = clean.match(/^\/admin\/people\/([^/]+)$/);
  if (peopleDetail) return { view: 'admin', section: 'members', detailId: peopleDetail[1] };

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
    case 'home':
      return '/';
    case 'channel':
      return pathForChannel(route.channelId, route.threadRootId);
    case 'threads':
      return '/threads';
    case 'activity':
      return '/activity';
    case 'tasks':
      return '/tasks';
    case 'saved':
      return '/later';
    case 'browse':
      return '/channels';
    case 'scheduled':
      return '/scheduled';
    case 'changelog':
      return '/whats-new';
    case 'help':
      return '/help';
    case 'permalink':
      return `/m/${route.messageId}`;
    case 'search':
      return '/search';
    case 'profile':
      return '/profile';
    case 'settings':
      return `/settings/${route.section}`;
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
export type StableView = Exclude<View, 'permalink' | 'channel'>;

/** The address of a conversation — what the sidebar, results and push payloads link. */
export function pathForChannel(channelId: string, threadRootId?: string): string {
  return threadRootId ? `/c/${channelId}/t/${threadRootId}` : `/c/${channelId}`;
}

export function pathForView(view: StableView): string {
  if (view === 'admin') return pathForRoute({ view, section: DEFAULT_ADMIN_SECTION });
  if (view === 'settings') return pathForRoute({ view, section: DEFAULT_SETTINGS_SECTION });
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
