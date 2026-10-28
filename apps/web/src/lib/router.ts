/** The client's URL.
 *
 * Three consoles, each with one owner. /settings is yours — theme, notifications, the
 * agents that run on your machine. /admin is this workspace: its name, who is in it, the
 * channels, the apps and agents, its data. /server is the machine, for whoever
 * administers it — every account on it, sign-on, what may be installed, whether it is
 * healthy. Blob is one open-source server, not a grid of workspaces, so there is no
 * fourth console for "workspaces"; the server's pages used to sit inside /admin with a
 * badge, which made one list of twenty-four rows out of two jobs.
 *
 * The server already cooperates: `SinglePageApp` answers any non-API path with
 * index.html, so /admin/members survives a hard refresh.
 */

import { useEffect, useState } from 'react';
import { leftFirstView } from './firstView.ts';

/**
 * Everything an admin configures in this workspace.
 *
 * Used to be split: /workspace for the name and the people, /admin for the machine.
 * That split was the multi-tenant idea leaking into the UI; then one list held both
 * jobs. The machine's own pages are /server now (`SERVER_SECTIONS`).
 */
export const ADMIN_SECTIONS = [
  'general',
  'appearance',
  'members',
  'groups',
  'invitations',
  'channels',
  'emoji',
  'calls',
  'feedback',
  'apps',
  'janus',
  'mcp-servers',
  'usage',
  'approvals',
  'webhooks',
  'deliveries',
  'connections',
  'export',
  'import',
  'retention',
  'posture',
  'audit',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/**
 * The machine, for whoever administers it: a fact about the person (`instance_admins`),
 * not a role in a workspace. Health is any admin's on the server, but it is about the
 * machine, so it lives here.
 */
export const SERVER_SECTIONS = [
  'health',
  'storage',
  'users',
  'sso',
  'app-policy',
  'logs',
] as const;

export type ServerSection = (typeof SERVER_SECTIONS)[number];

const DEFAULT_SERVER_SECTION: ServerSection = 'health';

/** Sections that have a detail page under them, at /server/:section/:id. */
export const SERVER_DETAIL_SECTIONS: readonly ServerSection[] = ['users'];

/** Yours. A private page, because these are not the server's business. */
export const SETTINGS_SECTIONS = ['preferences', 'security', 'my-agents', 'assistants'] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const DEFAULT_SETTINGS_SECTION: SettingsSection = 'preferences';

/** Sections that have a detail page under them, at /admin/:section/:id. */
export const ADMIN_DETAIL_SECTIONS: readonly AdminSection[] = [
  'members',
  'groups',
  'apps',
  // Calls is one page with two tabs, each a URL: /admin/calls/huddles, /admin/calls/meetups.
  'calls',
];

/** The tabs of the Calls page; a bare /admin/calls opens the first. */
export const CALL_TABS = ['huddles', 'meetups'] as const;

/** Where a bare /admin lands. */
const DEFAULT_ADMIN_SECTION: AdminSection = 'general';

/**
 * What a /search URL is looking through.
 *
 * `messages` is the default and is never written, so `/search?q=x` means exactly what it
 * has always meant and no screen has two URLs. The palette's own fifth state, `all`, is a
 * popup thing and never reaches a link.
 */
export type SearchScope = 'messages' | 'channels' | 'people' | 'files';

const SEARCH_SCOPES: readonly string[] = ['messages', 'channels', 'people', 'files'];

export type Route =
  | { view: 'home' }
  | { view: 'messages' }
  /** One conversation, addressable: /c/:channelId, optionally with an open thread. */
  | { view: 'channel'; channelId: string; threadRootId?: string }
  | { view: 'threads' }
  | { view: 'activity'; kind?: 'mention' }
  | { view: 'tasks' }
  | { view: 'agents' }
  /** The decision log: what conversations settled (M2 · A8). */
  | { view: 'decisions' }
  | { view: 'saved' }
  | { view: 'browse' }
  /** Every file you can see, or one conversation's — Slack's Files tab (M3 · B3). */
  | { view: 'files'; channelId?: string }
  | { view: 'scheduled' }
  /** What you typed and did not send, from every device (ADR 0037). */
  | { view: 'drafts' }
  | { view: 'changelog' }
  /** The guide: what everything on this screen is, and how to use it. */
  | { view: 'help' }
  /** A call, full screen. /call/:callId — /meetup/:id still opens, for old links. */
  | { view: 'call'; callId: string }
  /** A permalink to one message. Resolved, then replaced by the conversation. */
  | { view: 'permalink'; messageId: string }
  | { view: 'search'; query?: string; scope?: SearchScope }
  | { view: 'settings'; section: SettingsSection }
  | { view: 'admin'; section: AdminSection; detailId?: string }
  | { view: 'server'; section: ServerSection; detailId?: string };

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
  const [rawPath = '', rawQuery = ''] = path.split('?');
  const clean = rawPath.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(rawQuery);

  if (clean === '/' || clean === '/home') return { view: 'home' };
  const channelThread = clean.match(/^\/c\/([^/]+)\/t\/([^/]+)$/);
  if (channelThread) {
    return {
      view: 'channel',
      channelId: channelThread[1] as string,
      threadRootId: channelThread[2],
    };
  }
  const channelMessage = clean.match(/^\/c\/([^/]+)\/([^/]+)$/);
  if (channelMessage && channelMessage[2] !== 't') {
    return { view: 'permalink', messageId: channelMessage[2] as string };
  }
  const channel = clean.match(/^\/c\/([^/]+)$/);
  if (channel) {
    return { view: 'channel', channelId: channel[1] as string };
  }
  if (clean === '/threads') return { view: 'threads' };
  if (clean === '/activity') return { view: 'activity' };
  if (clean === '/mentions') return { view: 'activity', kind: 'mention' };
  if (clean === '/tasks') return { view: 'tasks' };
  if (clean === '/agents') return { view: 'agents' };
  if (clean === '/decisions') return { view: 'decisions' };
  if (clean === '/later') return { view: 'saved' };
  if (clean === '/channels') return { view: 'browse' };
  if (clean === '/files') {
    const channelId = params.get('channel');
    return channelId ? { view: 'files', channelId } : { view: 'files' };
  }
  if (clean === '/scheduled') return { view: 'scheduled' };
  if (clean === '/drafts') return { view: 'drafts' };
  if (clean === '/whats-new') return { view: 'changelog' };
  if (clean === '/help') return { view: 'help' };
  const call = clean.match(/^\/(?:call|meetup)\/([^/]+)$/);
  if (call) return { view: 'call', callId: call[1] as string };
  const permalink = clean.match(/^\/m\/([^/]+)$/);
  if (permalink) return { view: 'permalink', messageId: permalink[1] as string };
  if (clean === '/search') {
    // Shareable and bookmarkable, the way Slack's is: the search someone sent you
    // opens as the search they ran, looking through what they were looking through.
    const query = params.get('q') ?? '';
    const asked = params.get('scope');
    const scope =
      asked && asked !== 'messages' && SEARCH_SCOPES.includes(asked)
        ? (asked as SearchScope)
        : undefined;
    if (query) return scope ? { view: 'search', query, scope } : { view: 'search', query };
    return scope ? { view: 'search', scope } : { view: 'search' };
  }
  // Your profile, your preferences and your notifications were three pages; they are
  // one now, and both old URLs are real links people hold.
  if (clean === '/profile' || clean === '/settings/notifications') {
    return { view: 'settings', section: 'preferences' };
  }

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

  // The machine's pages sat under /admin until the server console: every one of those
  // URLs is a bookmark somewhere, and Huddles and Video meetups are one Calls page now.
  if (clean === '/admin/huddles') return { view: 'admin', section: 'calls', detailId: 'huddles' };
  if (clean === '/admin/meetups') return { view: 'admin', section: 'calls', detailId: 'meetups' };
  const movedToServer = clean.match(/^\/admin\/([^/]+)(?:\/([^/]+))?$/);
  if (movedToServer && (SERVER_SECTIONS as readonly string[]).includes(movedToServer[1] as string)) {
    return serverRoute(movedToServer[1] as ServerSection, movedToServer[2]) ?? { view: 'messages' };
  }

  if (clean === '/server') return { view: 'server', section: DEFAULT_SERVER_SECTION };
  const server = clean.match(/^\/server\/([^/]+)(?:\/([^/]+))?$/);
  if (server && (SERVER_SECTIONS as readonly string[]).includes(server[1] as string)) {
    const route = serverRoute(server[1] as ServerSection, server[2]);
    if (route) return route;
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
      if (section === 'calls') {
        // A tab is the only thing under Calls; anything else is not a page.
        if ((CALL_TABS as readonly string[]).includes(admin[2])) {
          return { view: 'admin', section, detailId: admin[2] };
        }
      } else if (ADMIN_DETAIL_SECTIONS.includes(section)) {
        return { view: 'admin', section, detailId: admin[2] };
      }
    }
  }

  return { view: 'messages' };
}

/** A /server page, or null when the section takes no detail and one was given. */
function serverRoute(section: ServerSection, detailId: string | undefined): Route | null {
  if (detailId === undefined) return { view: 'server', section };
  if (SERVER_DETAIL_SECTIONS.includes(section)) return { view: 'server', section, detailId };
  return null;
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
      return route.kind === 'mention' ? '/mentions' : '/activity';
    case 'tasks':
      return '/tasks';
    case 'agents':
      return '/agents';
    case 'decisions':
      return '/decisions';
    case 'saved':
      return '/later';
    case 'browse':
      return '/channels';
    case 'files':
      return route.channelId ? `/files?channel=${encodeURIComponent(route.channelId)}` : '/files';
    case 'scheduled':
      return '/scheduled';
    case 'drafts':
      return '/drafts';
    case 'changelog':
      return '/whats-new';
    case 'help':
      return '/help';
    case 'call':
      return `/call/${route.callId}`;
    case 'permalink':
      return `/m/${route.messageId}`;
    // A hand-built string rather than URLSearchParams, which writes a space as `+`:
    // the modifier grammar puts spaces in a query and `%20` is what round-trips.
    case 'search': {
      const scope = route.scope && route.scope !== 'messages' ? `scope=${route.scope}` : '';
      if (!route.query) return scope ? `/search?${scope}` : '/search';
      return `/search?q=${encodeURIComponent(route.query)}${scope ? `&${scope}` : ''}`;
    }
    case 'settings':
      return `/settings/${route.section}`;
    case 'admin':
      return route.detailId
        ? `/admin/${route.section}/${route.detailId}`
        : `/admin/${route.section}`;
    case 'server':
      return route.detailId
        ? `/server/${route.section}/${route.detailId}`
        : `/server/${route.section}`;
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
type StableView = Exclude<View, 'permalink' | 'channel' | 'call'>;

/** The address of a conversation — what the sidebar, results and push payloads link. */
export function pathForChannel(channelId: string, threadRootId?: string): string {
  return threadRootId ? `/c/${channelId}/t/${threadRootId}` : `/c/${channelId}`;
}

export function pathForView(view: StableView): string {
  if (view === 'admin') return pathForRoute({ view, section: DEFAULT_ADMIN_SECTION });
  if (view === 'server') return pathForRoute({ view, section: DEFAULT_SERVER_SECTION });
  if (view === 'settings') return pathForRoute({ view, section: DEFAULT_SETTINGS_SECTION });
  return pathForRoute({ view });
}

function currentPath(): string {
  // The query string is part of the path here, because one route carries state in it:
  // a search. Without it, `usePath` never changes as somebody types and the Back
  // button walks past the whole search rather than through it.
  return window.location.pathname + window.location.search;
}

/**
 * pushState does not notify anyone, so navigation dispatches the same event a Back
 * button would. One listener then serves both, and history stays a single source.
 */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === currentPath()) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else {
    // Somewhere else, on purpose: what shows from here on was switched to (`firstView`).
    leftFirstView();
    window.history.pushState(null, '', path);
  }
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
