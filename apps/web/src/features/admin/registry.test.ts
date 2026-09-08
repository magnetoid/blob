import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, SETTINGS_SECTIONS } from '../../lib/router.ts';
import {
  ADMIN_NAV,
  SETTINGS_NAV,
  filterGroups,
  isPlanned,
  sectionEntry,
  settingsEntry,
} from './registry.ts';

const entries = ADMIN_NAV.flatMap((group) => group.sections);
const live = entries.filter((entry) => !isPlanned(entry));

const settingsEntries = SETTINGS_NAV.flatMap((group) => group.sections);
const settingsLive = settingsEntries.filter((entry) => !isPlanned(entry));

describe('the admin registry', () => {
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
    expect(sectionEntry('members').label).toBe('Members');
    expect(sectionEntry('users').label).toBe('Accounts');
  });

  it('does not put Workspaces in the nav', () => {
    expect(live.map((entry) => entry.id)).not.toContain('workspaces');
  });
});

describe('the settings registry', () => {
  it('has exactly one nav row per route', () => {
    expect(settingsLive.map((entry) => entry.id).sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });

  it('uses each id once', () => {
    const ids = settingsEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds the entry for a section', () => {
    expect(settingsEntry('preferences').label).toBe('Preferences');
  });

  it('shares no section id with the admin console', () => {
    const admin = new Set(ADMIN_SECTIONS as readonly string[]);
    for (const id of SETTINGS_SECTIONS) expect(admin.has(id)).toBe(false);
  });
});

describe('filtering the nav', () => {
  it('returns everything when nothing is typed', () => {
    expect(filterGroups(ADMIN_NAV, '', true)).toHaveLength(ADMIN_NAV.length);
  });

  it('matches a keyword rather than only the label', () => {
    const found = filterGroups(ADMIN_NAV, 'roles', true).flatMap((g) => g.sections);
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
    const groups = [
      { id: 'you', label: 'You', sections: [{ id: 'preferences' as const, label: 'Preferences' }] },
      {
        id: 'server',
        label: 'This server',
        adminOnly: true,
        sections: [{ id: 'members' as const, label: 'Members' }],
      },
    ];
    expect(filterGroups(groups, '', false, false).map((g) => g.id)).toEqual(['you']);
    expect(filterGroups(groups, '', false, true).map((g) => g.id)).toEqual(['you', 'server']);
  });

  it('keeps personal settings on their own page', () => {
    expect(SETTINGS_NAV[0]?.id).toBe('you');
    expect(SETTINGS_NAV[0]?.adminOnly).toBeUndefined();
    expect(ADMIN_NAV.every((group) => group.id !== 'you')).toBe(true);
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
