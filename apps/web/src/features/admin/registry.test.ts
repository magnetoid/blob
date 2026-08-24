import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, WORKSPACE_SECTIONS } from '../../lib/router.ts';
import {
  ADMIN_NAV,
  WORKSPACE_NAV,
  filterGroups,
  isPlanned,
  sectionEntry,
  workspaceEntry,
} from './registry.ts';

const entries = ADMIN_NAV.flatMap((group) => group.sections);
const live = entries.filter((entry) => !isPlanned(entry));

const workspaceEntries = WORKSPACE_NAV.flatMap((group) => group.sections);
const workspaceLive = workspaceEntries.filter((entry) => !isPlanned(entry));

describe('the console registry', () => {
  // The drift guard. Three things have to agree — the router's list of URLs, the nav,
  // and the component map — and this is the cheapest place to catch two of them parting.
  it('has exactly one nav row per route', () => {
    expect(live.map((entry) => entry.id).sort()).toEqual([...ADMIN_SECTIONS].sort());
  });

  it('never gives a planned section a route', () => {
    for (const entry of entries.filter(isPlanned)) {
      expect(ADMIN_SECTIONS as readonly string[]).not.toContain(entry.id);
    }
  });

  it('uses each id once', () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels everything', () => {
    for (const entry of entries) expect(entry.label.length).toBeGreaterThan(0);
    for (const group of ADMIN_NAV) expect(group.label.length).toBeGreaterThan(0);
  });

  it('finds the entry for a section', () => {
    expect(sectionEntry('users').label).toBe('Accounts');
  });
});

// The same drift guard for the other console. The two lists are separate on purpose —
// a section belongs to one job or the other, never both — so each needs its own check.
describe('the workspace registry', () => {
  it('has exactly one nav row per route', () => {
    expect(workspaceLive.map((entry) => entry.id).sort()).toEqual([...WORKSPACE_SECTIONS].sort());
  });

  it('never gives a planned section a route', () => {
    for (const entry of workspaceEntries.filter(isPlanned)) {
      expect(WORKSPACE_SECTIONS as readonly string[]).not.toContain(entry.id);
    }
  });

  it('uses each id once', () => {
    const ids = workspaceEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds the entry for a section', () => {
    expect(workspaceEntry('members').label).toBe('Members');
  });

  // The split is the point: nothing workspace-scoped should reappear in the instance
  // console, which is how it drifted back into one console the first time.
  it('shares no section id with the instance console', () => {
    const instance = new Set(ADMIN_SECTIONS as readonly string[]);
    for (const id of WORKSPACE_SECTIONS) expect(instance.has(id)).toBe(false);
  });
});

describe('filtering the nav', () => {
  it('returns everything when nothing is typed', () => {
    expect(filterGroups(ADMIN_NAV, '', true)).toHaveLength(ADMIN_NAV.length);
  });

  it('matches a keyword rather than only the label', () => {
    // Someone looking for "roles" is looking for Members, which is a workspace page.
    const found = filterGroups(WORKSPACE_NAV, 'roles', true).flatMap((g) => g.sections);
    expect(found.map((entry) => entry.id)).toContain('members');
  });

  it('drops groups that end up empty', () => {
    const groups = filterGroups(ADMIN_NAV, 'audit', true);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sections.map((s) => s.id)).toEqual(['audit']);
  });

  it('says nothing matched rather than inventing a result', () => {
    expect(filterGroups(ADMIN_NAV, 'zzzzz', true)).toEqual([]);
  });

  it('hides an admin-only group from a member', () => {
    // The workspace page carries both scopes since preferences merged into it. A member
    // opening it must see their own sections and no sign that the others exist.
    const groups = [
      { id: 'you', label: 'You', sections: [{ id: 'preferences' as const, label: 'Preferences' }] },
      {
        id: 'workspace',
        label: 'Workspace',
        adminOnly: true,
        sections: [{ id: 'members' as const, label: 'Members' }],
      },
    ];
    expect(filterGroups(groups, '', false, false).map((g) => g.id)).toEqual(['you']);
    expect(filterGroups(groups, '', false, true).map((g) => g.id)).toEqual(['you', 'workspace']);
  });

  it('puts your own sections before the workspace ones on the merged page', () => {
    // Order is the whole argument for merging: everyone has the first group, only an
    // admin has the second, so the one everybody came for is on top.
    expect(WORKSPACE_NAV[0]?.id).toBe('you');
    expect(WORKSPACE_NAV[0]?.adminOnly).toBeUndefined();
    expect(WORKSPACE_NAV.slice(1).every((group) => group.adminOnly)).toBe(true);
  });

  it('hides owner-only rows from an admin', () => {
    const groups = [
      {
        id: 'g',
        label: 'Group',
        sections: [
          { id: 'health' as const, label: 'Health', ownerOnly: true },
          { id: 'audit' as const, label: 'Audit log' },
        ],
      },
    ];
    expect(filterGroups(groups, '', false)[0]?.sections.map((s) => s.id)).toEqual(['audit']);
    expect(filterGroups(groups, '', true)[0]?.sections).toHaveLength(2);
  });
});
