/** What the consoles contain, as data.
 *
 * The nav, the page headings and the filter all read from these lists, so adding a
 * section is a row here plus a component — not four files that have to agree.
 *
 * Two pages. **Settings** is yours: theme, notifications, the agents on your machine.
 * **Admin** is this server: its name, who is in it, the channels, the apps, the logs.
 * Blob is one open-source server, so there is no third "workspaces" console.
 *
 * Sections that are planned but not built are listed too, as `planned` rows. They are
 * shown disabled rather than hidden, because someone looking for retention wants to know
 * it is coming rather than conclude Blob has no such idea. They deliberately do not carry
 * a route id: the `*_SECTIONS` lists stay the set of URLs that actually exist.
 */

import type { AdminSection, SettingsSection } from '../../lib/router.ts';

export interface SectionEntry<Id extends string = string> {
  /** Typed as a section id, so a row for a route that does not exist fails typecheck. */
  id: Id;
  label: string;
  /** Sits under the page title. One sentence, saying what this page is for. */
  description?: string;
  /** Extra terms the nav filter should match — what someone might search instead. */
  keywords?: string[];
  badge?: 'new';
  ownerOnly?: boolean;
}

interface PlannedSectionEntry {
  /** Not a section id: there is no route until the page is real. */
  id: string;
  label: string;
  planned: true;
}

type NavEntry<Id extends string = string> = SectionEntry<Id> | PlannedSectionEntry;

export interface NavGroup<Id extends string = string> {
  id: string;
  label: string;
  /** One line under the heading, for a group whose audience is not obvious. */
  note?: string;
  sections: NavEntry<Id>[];
  /** Hidden from a plain member. Unused on the admin page (members never reach it). */
  adminOnly?: boolean;
}


export function isPlanned(entry: NavEntry): entry is PlannedSectionEntry {
  return 'planned' in entry;
}

/** Yours. Everyone has this page. */
export const SETTINGS_NAV: NavGroup<SettingsSection>[] = [
  {
    id: 'you',
    label: 'You',
    sections: [
      {
        id: 'preferences',
        label: 'Preferences',
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
 * This server. Admins see the people and the channels; the machine's own pages
 * (accounts, health, logs) stay owner-only because those endpoints are.
 */
export const ADMIN_NAV: NavGroup<AdminSection>[] = [
  {
    id: 'server',
    label: 'This server',
    sections: [
      {
        id: 'general',
        label: 'General',
        description: 'What this server is called, and what people see first.',
        keywords: ['name', 'settings', 'defaults', 'workspace'],
      },
      {
        id: 'appearance',
        label: 'Appearance',
        description: 'The colours everyone here sees.',
        keywords: ['theme', 'themes', 'colour', 'color', 'dark', 'light', 'palette'],
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    sections: [
      {
        id: 'members',
        label: 'Members',
        description: 'Everyone here, and what they can do.',
        keywords: ['users', 'people', 'roles', 'admin', 'owner', 'deactivate', 'sessions'],
      },
      {
        id: 'groups',
        label: 'User groups',
        description: 'Teams that can be mentioned as one name, like @platform-team.',
        keywords: ['team', 'teams', 'user group', '@team', 'mention', 'oncall'],
      },
      {
        id: 'invitations',
        label: 'Invitations',
        description: 'Who has been invited, and who has not arrived yet.',
        keywords: ['invite', 'join', 'link'],
      },
      {
        id: 'users',
        label: 'Accounts',
        description: 'Every account on this server.',
        keywords: ['users', 'people', 'accounts', 'members', 'everyone', 'directory'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'conversations',
    label: 'Conversations',
    sections: [
      {
        id: 'channels',
        label: 'Channels',
        description: 'Every channel here, including the private ones you are not in.',
        keywords: ['archive', 'private', 'public'],
      },
      { id: 'moderation', label: 'Moderation', planned: true },
      {
        id: 'emoji',
        label: 'Emoji',
        description: "This server's own emoji, for `:name:` in a message and for reactions.",
        keywords: ['custom', 'emoticon', 'reaction', 'shortcode'],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Agents & apps',
    sections: [
      {
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
      },
      {
        id: 'webhooks',
        label: 'Webhooks',
        description: 'Incoming URLs that let another system post into a channel here.',
        keywords: ['incoming', 'hooks', 'ci', 'integration'],
      },
      {
        id: 'deliveries',
        label: 'Deliveries',
        description: 'What was sent to each app, and a way to send a failed one again.',
        keywords: ['webhooks', 'outbox', 'retry', 'replay', 'circuit'],
      },
      {
        id: 'app-policy',
        label: 'App policy',
        description: 'What may be installed on this machine, and how many apps.',
        keywords: ['apps', 'agents', 'catalogue', 'catalog', 'permissions', 'limits', 'allow'],
        ownerOnly: true,
      },
      { id: 'approvals', label: 'Approvals', planned: true },
    ],
  },
  {
    id: 'machine',
    label: 'This machine',
    note: 'Only you can see these.',
    sections: [
      {
        id: 'health',
        label: 'Health',
        description: 'Whether the parts this server runs on are answering.',
        keywords: ['status', 'database', 'redis', 'queue', 'storage', 'version'],
        ownerOnly: true,
      },
      {
        id: 'audit',
        label: 'Audit log',
        description: 'Who did what, and from where.',
        keywords: ['events', 'security', 'history', 'forensics'],
        ownerOnly: true,
      },
      {
        id: 'logs',
        label: 'Errors and logs',
        description: 'What has gone wrong on this server recently.',
        keywords: ['errors', 'logs', 'exceptions', 'traceback', 'warnings', 'crash'],
        ownerOnly: true,
      },
      {
        id: 'feedback',
        label: 'Feedback',
        description: 'Bugs and requests filed from inside the app.',
        keywords: ['tickets', 'bugs', 'reports', 'requests'],
        ownerOnly: true,
      },
      { id: 'storage', label: 'Storage', planned: true },
      { id: 'import-export', label: 'Import / export', planned: true },
    ],
  },
];

function lookup<Id extends string>(groups: NavGroup<Id>[]): Map<string, SectionEntry<Id>> {
  return new Map(
    groups
      .flatMap((group) => group.sections)
      .filter((entry): entry is SectionEntry<Id> => !isPlanned(entry))
      .map((entry) => [entry.id, entry]),
  );
}

const ADMIN_BY_ID = lookup(ADMIN_NAV);
const SETTINGS_BY_ID = lookup(SETTINGS_NAV);

/** The registry row for a server section. Every live one has one — see registry.test.ts. */
export function sectionEntry(id: AdminSection): SectionEntry<AdminSection> {
  const entry = ADMIN_BY_ID.get(id);
  if (!entry) throw new Error(`No admin console entry for section "${id}".`);
  return entry;
}

/** The registry row for a personal-settings section. */
export function settingsEntry(id: SettingsSection): SectionEntry<SettingsSection> {
  const entry = SETTINGS_BY_ID.get(id);
  if (!entry) throw new Error(`No settings entry for section "${id}".`);
  return entry;
}

/**
 * The nav, narrowed to what someone typed and to what they are allowed to see.
 *
 * Groups that end up empty are dropped rather than left as bare headings, and a planned
 * row still matches — searching for "retention" should find the answer "not yet", not
 * nothing at all.
 */
export function filterGroups<Id extends string>(
  groups: NavGroup<Id>[],
  query: string,
  isOwner: boolean,
  isAdmin = true,
): NavGroup<Id>[] {
  const needle = query.trim().toLowerCase();
  return groups
    .filter((group) => !group.adminOnly || isAdmin)
    .map((group) => ({
      ...group,
      sections: group.sections.filter((entry) => {
        if (!isPlanned(entry) && entry.ownerOnly && !isOwner) return false;
        if (!needle) return true;
        if (entry.label.toLowerCase().includes(needle)) return true;
        if (group.label.toLowerCase().includes(needle)) return true;
        if (isPlanned(entry)) return false;
        return (entry.keywords ?? []).some((word) => word.includes(needle));
      }),
    }))
    .filter((group) => group.sections.length > 0);
}
