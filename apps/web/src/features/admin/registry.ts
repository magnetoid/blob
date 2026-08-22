/** What the console contains, as data.
 *
 * The nav, the page headings and the filter all read from this one list, so adding a
 * section is a row here plus a component — not four files that have to agree.
 *
 * Sections that are planned but not built are listed too, as `planned` rows. They are
 * shown disabled rather than hidden, because an admin looking for retention wants to
 * know it is coming rather than conclude Blob has no such idea. They deliberately do not
 * carry a route id: `ADMIN_SECTIONS` stays the list of URLs that actually exist.
 */

import type { AdminSection } from '../../lib/router.ts';

export interface AdminSectionEntry {
  /** Typed as AdminSection, so a row for a route that does not exist fails typecheck. */
  id: AdminSection;
  label: string;
  /** Sits under the page title. One sentence, saying what this page is for. */
  description?: string;
  /** Extra terms the nav filter should match — what someone might search instead. */
  keywords?: string[];
  badge?: 'new';
  ownerOnly?: boolean;
}

export interface PlannedSectionEntry {
  /** Not an AdminSection: there is no route until the page is real. */
  id: string;
  label: string;
  planned: true;
}

export type AdminNavEntry = AdminSectionEntry | PlannedSectionEntry;

export interface AdminNavGroup {
  id: string;
  label: string;
  sections: AdminNavEntry[];
}

export function isPlanned(entry: AdminNavEntry): entry is PlannedSectionEntry {
  return 'planned' in entry;
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    sections: [
      { id: 'dashboard', label: 'Dashboard', planned: true },
      {
        id: 'health',
        label: 'Health',
        description: 'Whether the parts this workspace runs on are answering.',
        keywords: ['status', 'database', 'redis', 'queue', 'storage', 'version'],
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    sections: [
      {
        id: 'people',
        label: 'Members',
        description: 'Everyone in the workspace, and what they can do.',
        keywords: ['users', 'roles', 'admin', 'owner', 'deactivate', 'sessions'],
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
    sections: [
      {
        id: 'channels',
        label: 'Channels',
        description: 'Every channel, including the private ones you are not in.',
        keywords: ['archive', 'private', 'public'],
      },
      { id: 'moderation', label: 'Moderation', planned: true },
      { id: 'emoji', label: 'Emoji', planned: true },
    ],
  },
  {
    id: 'agents',
    label: 'Agents & apps',
    sections: [
      { id: 'agents-directory', label: 'Agents', planned: true },
      {
        id: 'apps',
        label: 'Apps',
        description: 'Installed apps and the agents this workspace hosts.',
        keywords: ['plugins', 'bots', 'tokens', 'scopes', 'deploy', 'agent', 'github'],
      },
      { id: 'deliveries', label: 'Deliveries', planned: true },
      { id: 'approvals', label: 'Approvals', planned: true },
      {
        id: 'webhooks',
        label: 'Webhooks',
        description: 'Incoming URLs that let another system post into a channel.',
        keywords: ['incoming', 'hooks', 'ci', 'integration'],
      },
      { id: 'hosted-ai', label: 'Hosted AI', planned: true },
    ],
  },
  {
    id: 'system',
    label: 'System',
    sections: [
      {
        id: 'audit',
        label: 'Audit log',
        description: 'Who did what, and from where.',
        keywords: ['events', 'security', 'history', 'forensics'],
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

const BY_ID = new Map<string, AdminSectionEntry>(
  ADMIN_NAV.flatMap((group) => group.sections.filter((s) => !isPlanned(s)) as AdminSectionEntry[]).map(
    (entry) => [entry.id, entry],
  ),
);

/** The registry row for a section. Every live section has one — see registry.test.ts. */
export function sectionEntry(id: AdminSection): AdminSectionEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`No console entry for section "${id}".`);
  return entry;
}

/**
 * The nav, narrowed to what someone typed and to what they are allowed to see.
 *
 * Groups that end up empty are dropped rather than left as bare headings, and a planned
 * row still matches — searching for "retention" should find the answer "not yet", not
 * nothing at all.
 */
export function filterGroups(
  groups: AdminNavGroup[],
  query: string,
  isOwner: boolean,
): AdminNavGroup[] {
  const needle = query.trim().toLowerCase();
  return groups
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
