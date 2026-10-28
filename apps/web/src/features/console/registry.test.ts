import { describe, expect, it } from 'vitest';
import {
  ADMIN_SECTIONS,
  SERVER_SECTIONS,
  SETTINGS_SECTIONS,
  type AdminSection,
  type ServerSection,
} from '../../lib/router.ts';
import {
  ADMIN_NAV,
  ADMIN_ROWS,
  SERVER_NAV,
  SETTINGS_NAV,
  canOpen,
  filterGroups,
  filterSections,
  sectionEntry,
  serverEntry,
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

/** The workspace console, in nav order: the heading over each group, then its rows. */
const GROUPS: [string, string[]][] = [
  ['Workspace', ['General', 'Appearance', 'People', 'Channels', 'Emoji', 'Calls', 'Feedback']],
  [
    'Apps & agents',
    ['Apps & agents', 'Janus', 'MCP servers', 'Usage', 'Approvals', 'Webhooks', 'Deliveries', 'Assistants'],
  ],
  ['Data & security', ['Export', 'Import', 'Retention', 'Security', 'Audit log']],
];
const EVERY_ROW = GROUPS.flatMap(([, rows]) => rows);

/** The server console: the machine's pages, one list. */
const SERVER_ROWS = ['Health', 'Accounts', 'Single sign-on', 'App policy', 'Errors and logs'];
const serverRows = SERVER_NAV.flatMap((group) => group.sections);

/** What the nav offers this person, by label, for what they typed. */
const offered = (viewer: Viewer, query = '') =>
  filterGroups(ADMIN_NAV, query, viewer)
    .flatMap((group) => group.sections)
    .map((entry) => entry.label);

const settingsEntries = SETTINGS_NAV.flatMap((group) => group.sections);

describe('the admin registry', () => {
  it('has exactly one nav row per route', () => {
    expect(ADMIN_ROWS.map((entry) => entry.id).sort()).toEqual([...ADMIN_SECTIONS].sort());
  });

  it('uses each id once', () => {
    const ids = ADMIN_ROWS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels everything', () => {
    for (const entry of ADMIN_ROWS) expect(entry.label.length).toBeGreaterThan(0);
    for (const group of ADMIN_NAV) expect(group.label?.length).toBeGreaterThan(0);
  });

  it('is three groups, in the order the nav shows them', () => {
    expect(
      ADMIN_NAV.map((group) => [
        group.label,
        group.sections.filter((entry) => !entry.hidden).map((entry) => entry.label),
      ]),
    ).toEqual(GROUPS);
  });

  // Huddles and Video meetups were two rows for one media server and one set of rules.
  it('has one Calls page, found by either kind of call', () => {
    expect(sectionEntry('calls').label).toBe('Calls');
    for (const word of ['huddle', 'video', 'meetup', 'screen share', 'camera']) {
      expect(offered(ADMIN, word), word).toContain('Calls');
    }
  });

  // They were drawn disabled under a Soon badge. They were not pages, so they are gone,
  // and every row left is a URL that opens something. (Approvals was one, and came back in
  // M4 as a page that opens.)
  it('offers no row that is not a page', () => {
    const labels = ADMIN_ROWS.map((entry) => entry.label);
    for (const gone of ['Moderation', 'Storage', 'Import / export']) {
      expect(labels).not.toContain(gone);
    }
    for (const entry of ADMIN_ROWS) {
      expect(ADMIN_SECTIONS as readonly string[]).toContain(entry.id);
      expect(entry).not.toHaveProperty('planned');
    }
  });

  it('finds the entry for a section', () => {
    expect(sectionEntry('members').label).toBe('People');
    expect(serverEntry('users').label).toBe('Accounts');
  });

  it('keeps a folded section reachable but out of the nav', () => {
    // Groups and invitations now live on the People page. Their ids stay: bookmarks,
    // `/admin/groups/:id` and `sectionEntry` all still have to answer.
    for (const id of ['groups', 'invitations'] as const) {
      expect(sectionEntry(id).hidden).toBe(true);
    }
    const shown = filterSections(ADMIN_ROWS, '', FOUNDER).map((entry) => entry.id);
    expect(shown).toContain('members');
    expect(shown).not.toContain('groups');
    expect(shown).not.toContain('invitations');
  });

  it('finds the people page by any of the words the four pages answered to', () => {
    for (const word of ['invite', 'team', 'accounts', 'deactivate']) {
      const ids = filterSections(ADMIN_ROWS, word, ADMIN).map((entry) => entry.id);
      expect(ids, word).toContain('members');
    }
  });

  it('does not put Workspaces in the nav', () => {
    expect(ADMIN_ROWS.map((entry) => entry.id)).not.toContain('workspaces');
  });
});

describe('the server registry', () => {
  it('has exactly one nav row per route, in one list under no heading', () => {
    expect(serverRows.map((entry) => entry.id).sort()).toEqual([...SERVER_SECTIONS].sort());
    expect(SERVER_NAV).toHaveLength(1);
    expect(SERVER_NAV[0]?.label).toBeUndefined();
    expect(serverRows.map((entry) => entry.label)).toEqual(SERVER_ROWS);
  });

  // Every one is the machine's: an owner who does not run the server opens none of them
  // but Health, which the server lets any admin read.
  it('offers the server’s admin everything and a workspace owner only Health', () => {
    const rows = (viewer: Viewer) =>
      filterGroups(SERVER_NAV, '', viewer)
        .flatMap((group) => group.sections)
        .map((entry) => entry.label);
    expect(rows(SERVER_ADMIN)).toEqual(SERVER_ROWS);
    expect(rows(FOUNDER)).toEqual(SERVER_ROWS);
    expect(rows(OWNER)).toEqual(['Health']);
    expect(rows(ADMIN)).toEqual(['Health']);
    expect(rows(MEMBER)).toEqual([]);
  });

  it('keeps Accounts out of the workspace console', () => {
    expect(ADMIN_ROWS.map((entry) => entry.id)).not.toContain('users');
    expect(() => sectionEntry('users' as AdminSection)).toThrow();
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
    channels: 'admin', // /api/admin/channels
    emoji: 'admin', // /api/admin/emoji
    // /api/admin/calls. Its media-server panel reads /api/admin/calls/server, which is the
    // instance admin's, and answers anybody else with a line rather than an error.
    calls: 'admin',
    // /api/admin/plugins. The guardrails panel reads the instance policy and tolerates
    // its 403.
    apps: 'admin',
    // /api/admin/plugins and its controls. What Janus runs on, /api/admin/janus, is the
    // instance admin's, and the page tells anybody else who can change it.
    janus: 'admin',
    'mcp-servers': 'admin', // /api/admin/mcp-servers, and /api/admin/plugins for its agents
    usage: 'admin', // /api/admin/usage and its prices
    approvals: 'admin', // GET /api/admin/approvals
    export: 'admin', // /api/admin/exports, after a recent sign-in
    import: 'admin', // /api/admin/import
    posture: 'admin', // /api/admin/security; the server's half only for its admins
    retention: 'admin', // /api/admin/retention; saving asks for a recent sign-in
    webhooks: 'admin', // /api/admin/webhooks
    deliveries: 'admin', // /api/admin/deliveries
    connections: 'admin', // /api/admin/mcp-tokens
    audit: 'admin', // /api/admin/audit
    feedback: 'admin', // /api/admin/feedback
  };

  /** The machine's pages, by the same rule. */
  const MACHINE_GATE: Record<ServerSection, Access> = {
    // /api/admin/health is require_admin; the page asks for the server's log only when the
    // viewer is the server's administrator.
    health: 'admin',
    users: 'instance', // /api/admin/instance/users
    sso: 'instance', // /api/admin/instance/sso
    'app-policy': 'instance', // /api/admin/instance/workspaces/{id}/policy
    logs: 'instance', // /api/admin/instance/logs
  };

  it('matches the gate the server puts on each page', () => {
    for (const id of ADMIN_SECTIONS) expect(sectionEntry(id).access, id).toBe(SERVER_GATE[id]);
    for (const id of SERVER_SECTIONS) expect(serverEntry(id).access, id).toBe(MACHINE_GATE[id]);
  });

  it('offers a member nothing', () => {
    expect(offered(MEMBER)).toEqual([]);
  });

  // Nothing on the workspace console is anybody's but a workspace admin's now: the
  // machine's pages, which used to sit here badged, are the server console's.
  it('offers every admin every page, whatever else they are', () => {
    expect(offered(ADMIN)).toEqual(EVERY_ROW);
    expect(offered(OWNER)).toEqual(EVERY_ROW);
    expect(offered(SERVER_ADMIN)).toEqual(EVERY_ROW);
    expect(offered(FOUNDER)).toEqual(EVERY_ROW);
    expect(offered(ADMIN)).toContain('Audit log');
    expect(offered(ADMIN)).toContain('Feedback');
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
    // "app" is also the heading over the agents' rows, so every row under it answers.
    expect(offered(FOUNDER, 'app')).toEqual([
      'Appearance',
      'Apps & agents',
      'Janus',
      'MCP servers',
      'Usage',
      'Approvals',
      'Webhooks',
      'Deliveries',
      'Assistants',
    ]);
    expect(offered(ADMIN, 'app')).toEqual(offered(FOUNDER, 'app'));
  });

  it('matches a keyword rather than only the label', () => {
    expect(filterSections(ADMIN_ROWS, 'roles', ADMIN).map((entry) => entry.id)).toEqual([
      'members',
    ]);
  });

  it('finds a page by the heading it sits under', () => {
    expect(offered(ADMIN, 'security')).toEqual([
      'Export',
      'Import',
      'Retention',
      'Security',
      'Audit log',
    ]);
  });

  // The machine's pages are not on this console at all, whoever is looking.
  it('never finds a page that is not this console’s', () => {
    expect(offered(ADMIN, 'errors')).toEqual([]);
    expect(offered(SERVER_ADMIN, 'errors')).toEqual([]);
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
        'Sign-in & security',
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
