/** What the consoles contain, as data.
 *
 * The nav, the page headings and the filter all read from these lists, so adding a
 * section is a row here plus a component — not four files that have to agree.
 *
 * Three pages, one owner each. **Settings** is yours: theme, notifications, the agents
 * on your machine. **Admin** is this workspace: its name, who is in it, the channels,
 * the apps and agents, its data. **Server** is the machine, for whoever administers it:
 * every account, sign-on, app policy, health, the logs. Blob is one open-source server,
 * so there is no fourth "workspaces" console.
 *
 * Every row is a page that exists. The admin list used to carry five `planned` rows —
 * Moderation, Huddles, Approvals, Storage, Import / export — drawn disabled under a Soon
 * badge. They were not pages, and a nav that offers five things it cannot open is longer
 * and less true than one that does not; what is coming is the roadmap's to say.
 */

import type { AdminSection, ServerSection, SettingsSection } from '../../lib/router.ts';
import { SERVER_ACCESS, canOpen, type Access, type Viewer } from './access.ts';

export interface SectionEntry<Id extends string = string> {
  /** Typed as a section id, so a row for a route that does not exist fails typecheck. */
  id: Id;
  label: string;
  /** Sits under the page title. One sentence, saying what this page is for. */
  description?: string;
  /** Extra terms the nav filter should match — what someone might search instead. */
  keywords?: string[];
  badge?: 'new';
  /** Who the server lets in; see `Access`. Absent: anyone who can open the console. */
  access?: Access;
  /**
   * Reachable by URL, not offered in the nav.
   *
   * For a section whose page has been folded into another's — Members now shows user
   * groups, invitations and accounts on one page — but whose id has to survive: it is
   * in bookmarks, its detail pages (`/admin/groups/:id`) still open there, and
   * `sectionEntry` still has to answer for it. Dropping the row would have made
   * every one of those a 404 to save one line of nav.
   */
  hidden?: boolean;
}

export type { Access, Viewer } from './access.ts';
export { canOpen, viewerOf } from './access.ts';

/** A row of the workspace console. The level is required: a new page has to say whose it is. */
export interface AdminEntry extends SectionEntry<AdminSection> {
  access: Access;
}

/** A group of the workspace console: a heading over rows that are all about one thing. */
export interface AdminGroup extends NavGroup<AdminSection> {
  sections: AdminEntry[];
}

export interface NavGroup<Id extends string = string> {
  id: string;
  /** The heading over the rows. Absent, they sit under none: the server console is one list. */
  label?: string;
  sections: SectionEntry<Id>[];
  /** Hidden from a plain member. Unused on the admin page (members never reach it). */
  adminOnly?: boolean;
}

/** The person signed in, as a viewer. Nobody signed in passes no gate. */
export const SETTINGS_NAV: NavGroup<SettingsSection>[] = [
  {
    id: 'you',
    label: 'You',
    sections: [
      {
        id: 'preferences',
        // The page has held the profile, the preferences, notifications and the account
        // since they stopped being three screens — but the row still said "Preferences",
        // so somebody looking for their display name had no reason to open it. The id
        // stays `preferences` because it is a URL people have already bookmarked.
        label: 'Profile & preferences',
        description:
          'Who the workspace sees, how Blob looks, and when it may interrupt you.',
        keywords: [
          'profile', 'name', 'avatar', 'photo', 'status', 'title',
          'theme', 'dark', 'light', 'density', 'language', 'shortcuts', 'sign out',
          'notifications', 'quiet hours', 'do not disturb', 'dnd', 'keywords', 'alerts',
          'push', 'email', 'settings',
        ],
      },
      {
        id: 'security',
        label: 'Sign-in & security',
        description:
          'Your password, the devices you are signed in on, and what has happened to your sign-in lately.',
        keywords: [
          'password', 'change password', 'sessions', 'devices', 'sign out', 'signed in',
          'security', 'activity', 'history', 'login', 'two-step', '2fa', 'passkey',
        ],
      },
      {
        id: 'my-agents',
        label: 'My agents',
        description: 'Agents that run on your machine, answer only you, and go where you put them.',
        keywords: ['agent', 'personal agent', 'bridge', 'token', 'connect', 'desktop', 'laptop'],
      },
      {
        id: 'assistants',
        label: 'Assistants',
        description: 'Let an assistant you already use read this server as you, and post if you say so.',
        keywords: ['mcp', 'claude', 'claude code', 'assistant', 'model context protocol', 'token', 'connect', 'chatgpt', 'cursor', 'editor'],
      },
    ],
  },
];

/**
 * This server, as one list in the order the nav shows it.
 *
 * It was six groups under headings, and the headings were doing a permission's job
 * badly: "This machine — only you can see these" sat over pages a workspace admin could
 * open and pages the owner could not. Each row now says who may open it, in the server's
 * own terms, and a restricted row says so with a badge — so the list needs no buckets.
 */
/**
 * The workspace console, in three groups. One list of twenty-four rows was past the
 * point where a flat list works, and the headings it used to have were a permission's
 * job done badly — so the machine's rows are a console of their own now (`SERVER_NAV`),
 * and what is left is grouped by what it is about, not by who may open it.
 */
export const ADMIN_NAV: AdminGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    sections: [
      {
        id: 'general',
        label: 'General',
        description: 'What this server is called, and what people see first.',
        keywords: ['name', 'settings', 'defaults', 'workspace'],
        access: 'admin',
      },
      {
        id: 'appearance',
        label: 'Appearance',
        description: 'The colours everyone here sees.',
        keywords: ['theme', 'themes', 'colour', 'color', 'dark', 'light', 'palette'],
        access: 'admin',
      },
      {
        // One page, four parts — members, user groups, invitations and (for the server's
        // admin) every account on the server. They were four rows, and the only way to find
        // out which held the person you were after was to open all four; the same reason
        // You folded profile, preferences and notifications together.
        id: 'members',
        label: 'People',
        description: 'Everyone here, the groups they are in, who is invited, and every account.',
        keywords: [
          'users', 'people', 'roles', 'admin', 'owner', 'deactivate', 'sessions',
          'team', 'teams', 'user group', '@team', 'mention', 'oncall',
          'invite', 'invitations', 'join', 'link',
          'accounts', 'members', 'everyone', 'directory',
        ],
        access: 'admin',
      },
      // The three below are hidden, not gone: their URLs and detail pages still work.
      {
        id: 'groups',
        label: 'User groups',
        description: 'Teams that can be mentioned as one name, like @platform-team.',
        keywords: ['team', 'teams', 'user group', '@team', 'mention', 'oncall'],
        access: 'admin',
        hidden: true,
      },
      {
        id: 'invitations',
        label: 'Invitations',
        description: 'Who has been invited, and who has not arrived yet.',
        keywords: ['invite', 'join', 'link'],
        access: 'admin',
        hidden: true,
      },
      {
        id: 'channels',
        label: 'Channels',
        description: 'Every channel here, including the private ones you are not in.',
        keywords: ['archive', 'private', 'public'],
        access: 'admin',
      },
      {
        id: 'emoji',
        label: 'Emoji',
        description: "This server's own emoji, for `:name:` in a message and for reactions.",
        keywords: ['custom', 'emoticon', 'reaction', 'shortcode'],
        access: 'admin',
      },
      {
        // One page, two tabs — Huddles and Video meetups were two rows for one media server
        // and one set of rules. `admin` like both were: `/api/admin/calls`; the media
        // server's own status (`/api/admin/calls/server`) is the instance admin's, and the
        // panel says so in a line for anybody else.
        id: 'calls',
        label: 'Calls',
        description:
          'Huddles and video meetups: whether people can start them, what they may share, and how many can join.',
        keywords: [
          'huddle', 'audio', 'voice', 'call', 'calls', 'talk', 'livekit', 'screen share',
          'video', 'meeting', 'meetup', 'camera', 'conference', 'zoom', 'meet',
        ],
        access: 'admin',
      },
      {
        // `/api/admin/feedback`.
        id: 'feedback',
        label: 'Feedback',
        description: 'Bugs and requests filed from inside the app.',
        keywords: ['tickets', 'bugs', 'reports', 'requests'],
        access: 'admin',
      },
    ],
  },
  {
    id: 'agents',
    label: 'Apps & agents',
    sections: [
      {
        // `admin`, though its guardrails panel also reads the instance policy: refused, the
        // panel leaves that one line out rather than failing the list.
        id: 'apps',
        label: 'Apps & agents',
        description: 'Apps installed here, and the agents this server hosts.',
        keywords: [
          'plugins',
          'bots',
          'tokens',
          'scopes',
          'deploy',
          'agent',
          'agents',
          'github',
          'commands',
          'owner',
          'personal agent',
        ],
        access: 'admin',
      },
      {
        // `admin`, not `instance`: Janus is the agent every workspace here has, so its on/off,
        // its channels, its budget and what it is told to do are a workspace admin's. What it
        // runs on (`/api/admin/janus`) is the server admin's, and is a block inside the page
        // that tells anybody else as much.
        id: 'janus',
        label: 'Janus',
        description:
          "The agent every workspace here has: where it is, what it may spend, how it should behave — and, for the server's admin, what it runs on.",
        keywords: [
          'agent',
          'model',
          'provider',
          'deepseek',
          'key',
          'instructions',
          'toolsets',
          'skills',
          'restart',
        ],
        access: 'admin',
      },
      {
        // `/api/admin/mcp-servers` (ADR 0027): any admin's, like the agents it serves.
        id: 'mcp-servers',
        label: 'MCP servers',
        description:
          'Tools from outside Blob that agents may use — which agents, and which calls wait for the person who asked.',
        keywords: [
          'mcp',
          'tools',
          'connectors',
          'integrations',
          'servers',
          'github',
          'linear',
          'notion',
        ],
        access: 'admin',
      },
      {
        // `/api/admin/usage` (M2 · A9): any admin's — what agents spend is the workspace's.
        id: 'usage',
        label: 'Usage',
        description:
          'What agents and Blob’s own summaries spent, by agent and by person — priced per model, if you set prices.',
        keywords: ['cost', 'tokens', 'spend', 'budget', 'billing', 'prices', 'models', 'money'],
        access: 'admin',
      },
      {
        // `/api/admin/approvals`: what agents wait on across the workspace — the questions in a
        // room only where the admin can read it, as the run log shows a run's card.
        id: 'approvals',
        label: 'Approvals',
        description:
          'What agents are waiting on: questions nobody has answered yet, and runs that said they would come back.',
        keywords: ['approvals', 'approve', 'waiting', 'pending', 'decisions', 'questions', 'follow-up', 'coming back'],
        access: 'admin',
      },
      {
        id: 'webhooks',
        label: 'Webhooks',
        description: 'Incoming URLs that let another system post into a channel here.',
        keywords: ['incoming', 'hooks', 'ci', 'integration'],
        access: 'admin',
      },
      {
        id: 'deliveries',
        label: 'Deliveries',
        description: 'What was sent to each app, and a way to send a failed one again.',
        keywords: ['webhooks', 'outbox', 'retry', 'replay', 'circuit'],
        access: 'admin',
      },
      {
        // Not `assistants`: that is the Settings page where a person makes their own, and
        // the two consoles share no section id.
        id: 'connections',
        label: 'Assistants',
        description:
          "Every assistant connected here as one of its people — whose, what it may do, when it ends.",
        keywords: ['mcp', 'tokens', 'claude', 'connections', 'revoke'],
        access: 'admin',
      },
    ],
  },
  {
    id: 'data',
    label: 'Data & security',
    sections: [
      {
        // `/api/admin/exports` (M3 · B4): any admin's, after a recent sign-in — and only ever
        // the public conversations.
        id: 'export',
        label: 'Export',
        description:
          'Download the workspace’s public channels and its people as a zip of JSON lines.',
        keywords: ['export', 'download', 'backup', 'archive', 'data', 'portability', 'jsonl', 'zip'],
        access: 'admin',
      },
      {
        // `/api/admin/import` (ADR 0042): any admin's; what changes anything asks for a recent
        // sign-in, and watching one run does not.
        id: 'import',
        label: 'Import',
        description:
          'Bring a Slack workspace’s history here, and invite the people who came with it.',
        keywords: ['import', 'slack', 'migrate', 'move', 'history', 'upload', 'zip'],
        access: 'admin',
      },
      {
        // `/api/admin/retention` (ADR 0039): any admin's; saving a window or a hold asks for a
        // recent sign-in, which the step-up prompt answers on its own.
        id: 'retention',
        label: 'Retention',
        description:
          'How long messages and files are kept, and what a legal hold keeps past that.',
        keywords: [
          'retention',
          'delete',
          'history',
          'legal hold',
          'compliance',
          'gdpr',
          'ediscovery',
          'files',
          'purge',
        ],
        access: 'admin',
      },
      {
        // `/api/admin/security` (M3 · C3): any admin's; the server's half of the page appears
        // only for whoever runs the server, as the logs do.
        // `posture`, not `security`: the person's own Settings has a Security page already, and
        // the two consoles share no section id.
        id: 'posture',
        label: 'Security',
        description: 'How people and agents sign in and act here, and how the server was deployed.',
        keywords: ['security', 'posture', 'passkeys', 'two-step', 'mfa', 'cookie', 'redis'],
        access: 'admin',
      },
      {
        // `/api/admin/audit`, which reads this workspace's own events.
        id: 'audit',
        label: 'Audit log',
        description: 'Who did what, and from where.',
        keywords: ['events', 'security', 'history', 'forensics'],
        access: 'admin',
      },
    ],
  },
];

/** Every row of the workspace console, in nav order — for lookups and the filter. */
export const ADMIN_ROWS: AdminEntry[] = ADMIN_NAV.flatMap((group) => group.sections);

/** A row of the server console. Every one says whose it is, like the workspace's. */
export interface ServerEntry extends SectionEntry<ServerSection> {
  access: Access;
}

/**
 * The server console: the machine, for whoever administers it. One list under no
 * heading — five rows need none. Health is any admin's on the server, and is here
 * because it is about the machine; a workspace admin who does not run the server
 * reaches it by URL, not by nav.
 */
export const SERVER_NAV: NavGroup<ServerSection>[] = [
  {
    id: 'server',
    sections: [
      {
        // `/api/admin/health`, any admin's. The page adds the server's own log
        // (`/api/admin/instance/logs`) only for the server's administrator.
        id: 'health',
        label: 'Health',
        description: 'Whether the parts this server runs on are answering.',
        keywords: ['status', 'database', 'redis', 'queue', 'storage', 'version'],
        access: SERVER_ACCESS['health'],
      },
      {
        // `/api/admin/instance/users`. People draws the same list for the server's admin,
        // in this workspace's frame; here it is the whole server's.
        id: 'users',
        label: 'Accounts',
        description: 'Every account on this server.',
        keywords: ['users', 'people', 'accounts', 'members', 'everyone', 'directory'],
        access: SERVER_ACCESS['users'],
      },
      {
        // `/api/admin/instance/sso` (ADR 0033): the server's, since a person is one address
        // across every workspace on it.
        id: 'sso',
        label: 'Single sign-on',
        description:
          'Let people sign in with the account their organisation gives them — Google, Microsoft, Okta, Keycloak.',
        keywords: [
          'sso', 'oidc', 'openid', 'identity provider', 'idp', 'google workspace', 'microsoft',
          'entra', 'azure', 'okta', 'keycloak', 'login', 'sign in',
        ],
        access: SERVER_ACCESS['sso'],
      },
      {
        // `/api/admin/instance/workspaces/{id}/policy`.
        id: 'app-policy',
        label: 'App policy',
        description: 'What may be installed on this machine, and how many apps.',
        keywords: ['apps', 'agents', 'catalogue', 'catalog', 'permissions', 'limits', 'allow'],
        access: SERVER_ACCESS['app-policy'],
      },
      {
        // `/api/admin/instance/logs`: a traceback is about the machine.
        id: 'logs',
        label: 'Errors and logs',
        description: 'What has gone wrong on this server recently.',
        keywords: ['errors', 'logs', 'exceptions', 'traceback', 'warnings', 'crash'],
        access: SERVER_ACCESS['logs'],
      },
    ],
  },
];

const SERVER_ROWS: ServerEntry[] = SERVER_NAV.flatMap((group) => group.sections as ServerEntry[]);

function lookup<Entry extends SectionEntry>(entries: Entry[]): Map<string, Entry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

const ADMIN_BY_ID = lookup(ADMIN_ROWS);
const SERVER_BY_ID = lookup(SERVER_ROWS);
const SETTINGS_BY_ID = lookup(SETTINGS_NAV.flatMap((group) => group.sections));

/** The registry row for a workspace section. Every live one has one — see registry.test.ts. */
export function sectionEntry(id: AdminSection): AdminEntry {
  const entry = ADMIN_BY_ID.get(id);
  if (!entry) throw new Error(`No admin console entry for section "${id}".`);
  return entry;
}

/** The registry row for a server section. */
export function serverEntry(id: ServerSection): ServerEntry {
  const entry = SERVER_BY_ID.get(id);
  if (!entry) throw new Error(`No server console entry for section "${id}".`);
  return entry;
}

/** The registry row for a personal-settings section. */
export function settingsEntry(id: SettingsSection): SectionEntry<SettingsSection> {
  const entry = SETTINGS_BY_ID.get(id);
  if (!entry) throw new Error(`No settings entry for section "${id}".`);
  return entry;
}

/**
 * The rows of one list that this person may open and that answer what they typed, in
 * the list's order: matched on the label, a keyword, or the heading the list sits under.
 * Nothing typed matches every row the person may open.
 */
export function filterSections<Entry extends SectionEntry>(
  entries: Entry[],
  query: string,
  viewer: Viewer,
  heading?: string,
): Entry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (entry.hidden) return false;
    if (entry.access && !canOpen(entry.access, viewer)) return false;
    if (!needle) return true;
    if (entry.label.toLowerCase().includes(needle)) return true;
    if (heading?.toLowerCase().includes(needle)) return true;
    return (entry.keywords ?? []).some((word) => word.includes(needle));
  });
}

/**
 * The nav, narrowed to what someone typed and to what they are allowed to see.
 *
 * A group left with no rows is dropped rather than drawn as a bare heading.
 */
export function filterGroups<Id extends string>(
  groups: NavGroup<Id>[],
  query: string,
  viewer: Viewer,
): NavGroup<Id>[] {
  return groups
    .filter((group) => !group.adminOnly || canOpen('admin', viewer))
    .map((group) => ({
      ...group,
      sections: filterSections(group.sections, query, viewer, group.label),
    }))
    .filter((group) => group.sections.length > 0);
}
