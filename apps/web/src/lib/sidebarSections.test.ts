/** Sections of your own in the channel list: the list arithmetic (M3 · B3). */
import { describe, expect, it } from 'vitest';
import type { SidebarSection } from '@blob/shared';
import {
  addSection,
  placeIn,
  removeSection,
  renameSection,
  sectionOf,
  sectioned,
  toggleCollapsed,
} from './sidebarSections.ts';

const CLIENTS: SidebarSection = { id: 'a', name: 'Clients', channelIds: ['c1', 'c2'], collapsed: false };
const LAUNCH: SidebarSection = { id: 'b', name: 'Launch', channelIds: ['c3'], collapsed: false };

describe('sections', () => {
  it('hold a conversation in one place at a time', () => {
    const moved = placeIn([CLIENTS, LAUNCH], 'c1', 'b');
    expect(sectionOf(moved, 'c1')?.id).toBe('b');
    expect(moved[0]?.channelIds).toEqual(['c2']);
    expect(moved[1]?.channelIds).toEqual(['c3', 'c1']);
  });

  it('let a conversation go back to the default lists', () => {
    const out = placeIn([CLIENTS, LAUNCH], 'c2', null);
    expect(sectionOf(out, 'c2')).toBeUndefined();
    expect([...sectioned(out)]).toEqual(['c1', 'c3']);
  });

  it('are added last, with a conversation if one is moving', () => {
    const { sections, id } = addSection([CLIENTS], '  Partners  ', 'c1');
    expect(sections.map((s) => s.name)).toEqual(['Clients', 'Partners']);
    expect(sectionOf(sections, 'c1')?.id).toBe(id);
    expect(sections[0]?.channelIds).toEqual(['c2']);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('are renamed, but never to nothing', () => {
    expect(renameSection([CLIENTS], 'a', ' Customers ')[0]?.name).toBe('Customers');
    expect(renameSection([CLIENTS], 'a', '   ')[0]?.name).toBe('Clients');
  });

  it('give their conversations back when removed', () => {
    const left = removeSection([CLIENTS, LAUNCH], 'a');
    expect(left).toEqual([LAUNCH]);
    expect(sectioned(left).has('c1')).toBe(false);
  });

  it('fold and unfold', () => {
    expect(toggleCollapsed([CLIENTS], 'a')[0]?.collapsed).toBe(true);
  });
});
