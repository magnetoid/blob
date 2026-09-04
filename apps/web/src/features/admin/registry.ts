/** What the consoles contain, as data.
 *
 * The nav, the page headings and the filter all read from these lists, so adding a
 * section is a row here plus a component — not four files that have to agree.
 *
 * There are two consoles and the split is the point. **Workspace** answers "what is this
 * workspace like and who is in it": members, invitations, channels, the apps it has
 * installed, the webhooks pointing at it, how it looks. **Instance** answers "what is
 * true of this server": every account on it, every workspace on it, which apps a
 * workspace is allowed to install, and whether the machine is healthy.
 *
 * Members, invitations, channels, apps and webhooks used to sit in the instance console.
 * Each one is a question about a single workspace, and having them there made one job
 * look like two — an owner went to "superadmin" to invite a colleague. They moved.
 *
 * Sections that are planned but not built are listed too, as `planned` rows. They are
 * shown disabled rather than hidden, because someone looking for retention wants to know
 * it is coming rather than conclude Blob has no such idea. They deliberately do not carry
 * a route id: the `*_SECTIONS` lists stay the set of URLs that actually exist.
 */

import type { AdminSection, WorkspaceSection } from '../../lib/router.ts';

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

export interface PlannedSectionEntry {
  /** Not a section id: there is no route until the page is real. */
  id: string;
  label: string;
  planned: true;
}

export type NavEntry<Id extends string = string> = SectionEntry<Id> | PlannedSectionEntry;

export interface NavGroup<Id extends string = string> {
  id: string;
  label: string;
  sections: NavEntry<Id>[];
  /**
   * Hidden from a plain member.
   *
   * This page carries two scopes since preferences folded into it: what is yours, which
   * everyone has, and what is the workspace's, which only an admin may touch. The flag
   * is on the *group* rather than on each row so the two cannot drift apart — a section
   * added to an admin group is admin-gated by being there.
   */
  adminOnly?: boolean;
}

/** Kept as the old names so nothing outside has to learn two words for one thing. */
export type AdminSectionEntry = SectionEntry<AdminSection>;
export type AdminNavEntry = NavEntry<AdminSection>;
export type AdminNavGroup = NavGroup<AdminSection>;

export function isPlanned(entry: NavEntry): entry is PlannedSectionEntry {
  return 'planned' in entry;
}

/**
 * Everything you can configure, in one page.
 *
 * Two groups and the order is the point: yours first, because every member has those and
 * most people came here for them, then the workspace's, which only an admin sees.
 * Preferences used to be a separate page with a separate layout — one word, "settings",
 * pointing at two differently-shaped screens.
 */
export const WORKSPACE_NAV: NavGroup<WorkspaceSection>[] = [
  {
    id: 'you',
    label: 'You',
    sections: [
      {
        id: 'preferences',
        label: 'Preferences',
        description: 'How Blob looks and behaves for you, on this device and everywhere.',
        keywords: ['theme', 'dark', 'light', 'density', 'language', 'sign out', 'settings'],
      },
      {
        id: 'notifications',
        label: 'Notifications',
        description: 'When Blob is allowed to interrupt you, and what counts as urgent.',
        keywords: ['quiet hours', 'do not disturb', 'dnd', 'keywords', 'alerts'],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    adminOnly: true,
    sections: [
      {
        id: 'general',
        label: 'General',
        description: 'What this workspace is called, and what people see first.',
        keywords: ['name', 'settings', 'defaults'],
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
    adminOnly: true,
    sections: [
      {
        id: 'members',
        label: 'Members',
        description: 'Everyone in this workspace, and what they can do.',
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
    ],
  },
  {
    id: 'conversations',
    label: 'Conversations',
    adminOnly: true,
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
        description: "The workspace's own emoji, for `:name:` in a message and for reactions.",
        keywords: ['custom', 'emoticon', 'reaction', 'shortcode'],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Agents & apps',
    adminOnly: true,
    sections: [
      {
        id: 'apps',
        label: 'Apps & agents',
        description: 'Apps installed here, and the agents this workspace hosts.',
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
      { id: 'deliveries', label: 'Deliveries', planned: true },
      { id: 'approvals', label: 'Approvals', planned: true },
    ],
  },
];

/** The whole server, across every workspace on it. */
export const ADMIN_NAV: NavGroup<AdminSection>[] = [
  {
    id: 'instance',
    label: 'Instance',
    sections: [
      {
        id: 'users',
        label: 'Accounts',
        description: 'Every account on this server, and the workspace it belongs to.',
        keywords: ['users', 'people', 'accounts', 'members', 'everyone', 'directory'],
      },
      {
        id: 'workspaces',
        label: 'Workspaces',
        description: 'Every workspace on this server.',
        keywords: ['tenants', 'teams', 'organisations', 'organizations'],
      },
      {
        id: 'app-policy',
        label: 'App policy',
        description: 'What each workspace may do to this machine, and how many apps it may install.',
        keywords: ['apps', 'agents', 'catalogue', 'catalog', 'permissions', 'limits', 'allow'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    sections: [
      {
        id: 'health',
        label: 'Health',
        description: 'Whether the parts this server runs on are answering.',
        keywords: ['status', 'database', 'redis', 'queue', 'storage', 'version'],
      },
      {
        id: 'audit',
        label: 'Audit log',
        description: 'Who did what, and from where.',
        keywords: ['events', 'security', 'history', 'forensics'],
      },
      {
        id: 'logs',
        label: 'Errors and logs',
        description: 'What has gone wrong on this server recently.',
        keywords: ['errors', 'logs', 'exceptions', 'traceback', 'warnings', 'crash'],
      },
      {
        id: 'feedback',
        label: 'Feedback',
        description: 'Bugs and requests filed from inside the app.',
        keywords: ['tickets', 'bugs', 'reports', 'requests'],
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
const WORKSPACE_BY_ID = lookup(WORKSPACE_NAV);

/** The registry row for an instance section. Every live one has one — see registry.test.ts. */
export function sectionEntry(id: AdminSection): SectionEntry<AdminSection> {
  const entry = ADMIN_BY_ID.get(id);
  if (!entry) throw new Error(`No instance console entry for section "${id}".`);
  return entry;
}

/** The registry row for a workspace section. */
export function workspaceEntry(id: WorkspaceSection): SectionEntry<WorkspaceSection> {
  const entry = WORKSPACE_BY_ID.get(id);
  if (!entry) throw new Error(`No workspace console entry for section "${id}".`);
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
