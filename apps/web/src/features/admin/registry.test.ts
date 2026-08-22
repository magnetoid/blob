import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS } from '../../lib/router.ts';
import { ADMIN_NAV, filterGroups, isPlanned, sectionEntry } from './registry.ts';

const entries = ADMIN_NAV.flatMap((group) => group.sections);
const live = entries.filter((entry) => !isPlanned(entry));

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
    expect(sectionEntry('people').label).toBe('Members');
  });
});

describe('filtering the nav', () => {
  it('returns everything when nothing is typed', () => {
    expect(filterGroups(ADMIN_NAV, '', true)).toHaveLength(ADMIN_NAV.length);
  });

  it('matches a keyword rather than only the label', () => {
    // Someone looking for "roles" is looking for Members.
    const found = filterGroups(ADMIN_NAV, 'roles', true).flatMap((g) => g.sections);
    expect(found.map((entry) => entry.id)).toContain('people');
  });

  it('drops groups that end up empty', () => {
    const groups = filterGroups(ADMIN_NAV, 'audit', true);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sections.map((s) => s.id)).toEqual(['audit']);
  });

  it('says nothing matched rather than inventing a result', () => {
    expect(filterGroups(ADMIN_NAV, 'zzzzz', true)).toEqual([]);
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
