import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, SETTINGS_SECTIONS, type AdminSection } from '../../lib/router.ts';
import {
  ADMIN_NAV,
  SETTINGS_NAV,
  canOpen,
  filterGroups,
  filterSections,
  sectionEntry,
  settingsEntry,
  viewerOf,
  type Access,
  type NavGroup,
  type Viewer,
} from './registry.ts';

/** Never reaches /admin — Workspace sends them back — but the rule still has an answer. */
const MEMBER: Viewer = { role: 'member', isInstanceAdmin: false };
const ADMIN: Viewer = { role: 'admin', isInstanceAdmin: false };
/** Owns a workspace on a server somebody else runs: the case `ownerOnly` got wrong. */
const OWNER: Viewer = { role: 'owner', isInstanceAdmin: false };
/** Runs the server, and is a plain admin of the workspace they are signed into. */
const SERVER_ADMIN: Viewer = { role: 'admin', isInstanceAdmin: true };
/** Founded the server and its first workspace: the usual single-workspace case. */
const FOUNDER: Viewer = { role: 'owner', isInstanceAdmin: true };

const EVERY_ROW = [
  'General',
  'Appearance',
  'People',
  'Channels',
  'Emoji',
  'Video meetups',
  'Apps & agents',
  'Janus',
  'MCP servers',
  'Usage',
  'Webhooks',
  'Deliveries',
  'Assistants',
  'App policy',
  'Health',
  'Audit log',
  'Errors and logs',
  'Feedback',
];

const SERVER_ROWS = ['App policy', 'Errors and logs'];

/** What the nav offers this person, by label, for what they typed. */
const offered = (viewer: Viewer, query = '') =>
  filterSections(ADMIN_NAV, query, viewer).map((entry) => entry.label);

const settingsEntries = SETTINGS_NAV.flatMap((group) => group.sections);

describe('the admin registry', () => {
  it('has exactly one nav row per route', () => {
    expect(ADMIN_NAV.map((entry) => entry.id).sort()).toEqual([...ADMIN_SECTIONS].sort());
  });

  it('uses each id once', () => {
    const ids = ADMIN_NAV.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels everything', () => {
    for (const entry of ADMIN_NAV) expect(entry.label.length).toBeGreaterThan(0);
  });

  it('is one list, in the order the nav shows it', () => {
    expect(ADMIN_NAV.filter((entry) => !entry.hidden).map((entry) => entry.label)).toEqual(
      EVERY_ROW,
    );
  });

  // They were drawn disabled under a Soon badge. They were not pages, so they are gone,
  // and every row left is a URL that opens something.
  it('offers no row that is not a page', () => {
    const labels = ADMIN_NAV.map((entry) => entry.label);
    for (const gone of ['Moderation', 'Huddles', 'Approvals', 'Storage', 'Import / export']) {
      expect(labels).not.toContain(gone);
    }
    for (const entry of ADMIN_NAV) {
      expect(ADMIN_SECTIONS as readonly string[]).toContain(entry.id);
      expect(entry).not.toHaveProperty('planned');
    }
  });

  it('finds the entry for a section', () => {
    expect(sectionEntry('members').label).toBe('People');
    expect(sectionEntry('users').label).toBe('Accounts');
  });

  it('keeps a folded section reachable but out of the nav', () => {
    // Groups, invitations and accounts now live on the People page. Their ids stay:
    // bookmarks, `/admin/groups/:id` and `sectionEntry` all still have to answer.
    for (const id of ['groups', 'invitations', 'users'] as const) {
      expect(sectionEntry(id).hidden).toBe(true);
    }
    const shown = filterSections(ADMIN_NAV, '', FOUNDER).map((entry) => entry.id);
    expect(shown).toContain('members');
    expect(shown).not.toContain('groups');
    expect(shown).not.toContain('invitations');
    expect(shown).not.toContain('users');
  });

  it('finds the people page by any of the words the four pages answered to', () => {
    for (const word of ['invite', 'team', 'accounts', 'deactivate']) {
      const ids = filterSections(ADMIN_NAV, word, ADMIN).map((entry) => entry.id);
      expect(ids, word).toContain('members');
    }
  });

  it('does not put Workspaces in the nav', () => {
    expect(ADMIN_NAV.map((entry) => entry.id)).not.toContain('workspaces');
  });
});

describe('who each admin page is for', () => {
  /**
   * The gate on what each page cannot work without, read off the routers. `admin` is
   * `require_admin`, `instance` is `require_instance_admin`; no page is `require_owner`
   * as a whole — the one owner-only control, changing a role, sits inside People and is
   * drawn for the owner alone.
   */
  const SERVER_GATE: Record<AdminSection, Access> = {
    general: 'admin', // GET/PATCH /api/admin/settings
    appearance: 'admin', // PUT/DELETE /api/admin/themes
    members: 'admin', // /api/admin/users, /api/admin/groups, /api/admin/invites
    groups: 'admin', // /api/admin/groups
    invitations: 'admin', // /api/admin/invites, POST /api/invites
    users: 'instance', // /api/admin/instance/users
    channels: 'admin', // /api/admin/channels
    emoji: 'admin', // /api/admin/emoji
    // /api/admin/calls. Its media-server panel reads /api/admin/calls/server, which is the
    // instance admin's, and answers anybody else with a line rather than an error.
    meetups: 'admin',
    // /api/admin/plugins. The guardrails panel reads the instance policy and tolerates
    // its 403.
    apps: 'admin',
    // /api/admin/plugins and its controls. What Janus runs on, /api/admin/janus, is the
    // instance admin's, and the page tells anybody else who can change it.
    janus: 'admin',
    'mcp-servers': 'admin', // /api/admin/mcp-servers, and /api/admin/plugins for its agents
    usage: 'admin', // /api/admin/usage and its prices
    webhooks: 'admin', // /api/admin/webhooks
    deliveries: 'admin', // /api/admin/deliveries
    connections: 'admin', // /api/admin/mcp-tokens
    'app-policy': 'instance', // /api/admin/instance/workspaces/{id}/policy
    // /api/admin/health is require_admin; the page asks for the server's log only when the
    // viewer is the server's administrator.
    health: 'admin',
    audit: 'admin', // /api/admin/audit
    logs: 'instance', // /api/admin/instance/logs
    feedback: 'admin', // /api/admin/feedback
  };

  it('matches the gate the server puts on each page', () => {
    for (const id of ADMIN_SECTIONS) expect(sectionEntry(id).access, id).toBe(SERVER_GATE[id]);
  });

  it('offers a member nothing', () => {
    expect(offered(MEMBER)).toEqual([]);
  });

  it('offers a workspace admin every page but the server’s own', () => {
    expect(offered(ADMIN)).toEqual(EVERY_ROW.filter((label) => !SERVER_ROWS.includes(label)));
  });

  // Health, the audit log and feedback used to be the owner's alone, while the server let
  // any admin read the audit log and the feedback; and an owner who does not run the
  // server was offered three pages that answer them 403.
  it('offers the owner of a workspace what its admins see, and no more', () => {
    expect(offered(OWNER)).toEqual(offered(ADMIN));
    expect(offered(ADMIN)).toContain('Audit log');
    expect(offered(ADMIN)).toContain('Feedback');
    expect(offered(ADMIN)).toContain('Health');
  });

  it('offers the server’s admin everything, whatever their role in this workspace', () => {
    expect(offered(SERVER_ADMIN)).toEqual(EVERY_ROW);
    expect(offered(FOUNDER)).toEqual(EVERY_ROW);
  });

  it('answers each gate the way lib/auth.py does', () => {
    const table = (viewer: Viewer) =>
      (['admin', 'owner', 'instance'] as const).map((access) => canOpen(access, viewer));
    expect(table(MEMBER)).toEqual([false, false, false]);
    expect(table(ADMIN)).toEqual([true, false, false]);
    expect(table(OWNER)).toEqual([true, true, false]);
    expect(table(SERVER_ADMIN)).toEqual([true, false, true]);
    expect(table(FOUNDER)).toEqual([true, true, true]);
    // A fact about the person, not their role here: `instance_admins` is keyed on email.
    expect(canOpen('instance', { role: 'member', isInstanceAdmin: true })).toBe(true);
  });

  it('reads who is looking off the signed-in person', () => {
    expect(viewerOf({ role: 'owner', isInstanceAdmin: true })).toEqual(FOUNDER);
    expect(viewerOf({ role: 'admin', isInstanceAdmin: false })).toEqual(ADMIN);
    // Nobody signed in passes no gate.
    expect(viewerOf(null)).toEqual(MEMBER);
  });
});

describe('filtering the admin nav', () => {
  it('returns every row the person may open when nothing is typed', () => {
    expect(offered(FOUNDER, '')).toEqual(EVERY_ROW);
    expect(offered(ADMIN, '   ')).toEqual(offered(ADMIN));
  });

  it('narrows to the rows that match, in the list’s order', () => {
    expect(offered(FOUNDER, 'audit')).toEqual(['Audit log']);
    expect(offered(FOUNDER, 'AUDIT ')).toEqual(['Audit log']);
    expect(offered(FOUNDER, 'app')).toEqual(['Appearance', 'Apps & agents', 'App policy']);
    expect(offered(ADMIN, 'app')).toEqual(['Appearance', 'Apps & agents']);
  });

  it('matches a keyword rather than only the label', () => {
    expect(filterSections(ADMIN_NAV, 'roles', ADMIN).map((entry) => entry.id)).toEqual([
      'members',
    ]);
  });

  // "Calls" was the heading over Video meetups; the word still finds it.
  it('finds a page by the word its old heading carried', () => {
    expect(offered(ADMIN, 'calls')).toEqual(['Video meetups']);
  });

  it('never finds a page the person may not open', () => {
    expect(offered(ADMIN, 'errors')).toEqual([]);
    expect(offered(SERVER_ADMIN, 'errors')).toEqual(['Errors and logs']);
  });

  it('says nothing matched rather than inventing a result', () => {
    expect(offered(FOUNDER, 'zzzzz')).toEqual([]);
  });
});

describe('the settings registry', () => {
  it('has exactly one nav row per route', () => {
    expect(settingsEntries.map((entry) => entry.id).sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });

  it('uses each id once', () => {
    const ids = settingsEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds the entry for a section', () => {
    expect(settingsEntry('preferences').label).toBe('Profile & preferences');
  });

  it('shares no section id with the admin console', () => {
    const admin = new Set(ADMIN_SECTIONS as readonly string[]);
    for (const id of SETTINGS_SECTIONS) expect(admin.has(id)).toBe(false);
  });

  it('keeps personal settings on their own page, under their heading, for everyone', () => {
    expect(SETTINGS_NAV.map((group) => group.label)).toEqual(['You']);
    expect(SETTINGS_NAV[0]?.adminOnly).toBeUndefined();
    for (const viewer of [MEMBER, ADMIN, OWNER, FOUNDER]) {
      const groups = filterGroups(SETTINGS_NAV, '', viewer);
      expect(groups.map((group) => group.label)).toEqual(['You']);
      expect(groups[0]?.sections.map((entry) => entry.label)).toEqual([
        'Profile & preferences',
        'My agents',
        'Assistants',
      ]);
    }
  });
});

describe('filtering a nav in groups', () => {
  const GROUPS: NavGroup[] = [
    { id: 'you', label: 'You', sections: [{ id: 'preferences', label: 'Preferences' }] },
    {
      id: 'server',
      label: 'This server',
      adminOnly: true,
      sections: [
        { id: 'members', label: 'Members' },
        { id: 'health', label: 'Health', access: 'instance' },
        { id: 'roles', label: 'Roles', access: 'owner' },
      ],
    },
  ];

  const shown = (viewer: Viewer, query = '') =>
    filterGroups(GROUPS, query, viewer).map((group) => [
      group.id,
      group.sections.map((entry) => entry.id),
    ]);

  it('hides an admin-only group from a member', () => {
    expect(shown(MEMBER)).toEqual([['you', ['preferences']]]);
  });

  it('hides each row behind a gate the person does not pass', () => {
    expect(shown(ADMIN)).toEqual([
      ['you', ['preferences']],
      ['server', ['members']],
    ]);
    expect(shown(OWNER)).toEqual([
      ['you', ['preferences']],
      ['server', ['members', 'roles']],
    ]);
    expect(shown(SERVER_ADMIN)).toEqual([
      ['you', ['preferences']],
      ['server', ['members', 'health']],
    ]);
  });

  it('matches a group’s heading, and drops a group left with nothing under it', () => {
    expect(shown(FOUNDER, 'this server')).toEqual([['server', ['members', 'health', 'roles']]]);
    expect(shown(FOUNDER, 'prefer')).toEqual([['you', ['preferences']]]);
    expect(shown(FOUNDER, 'zzzzz')).toEqual([]);
  });
});
