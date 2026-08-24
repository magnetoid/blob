/**
 * The account menu is the only way to reach several pages, so a row pointing at a route
 * that does not exist is a page nobody can open — and it fails as a dead click rather
 * than as an error, which is the kind of thing that survives a long time unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { ITEMS } from './menu.ts';
import { parseRoute } from '../../lib/router.ts';

describe('the account menu', () => {
  it('only links to routes that resolve', () => {
    // An unknown path falls back to the conversation, so any row other than "/" that
    // parses to `messages` is pointing at nothing.
    const dead = ITEMS.filter(
      (item) => item.path && item.path !== '/' && parseRoute(item.path).view === 'messages',
    );
    expect(dead.map((item) => `${item.label} → ${item.path}`)).toEqual([]);
  });

  it('separates the three things that were all called settings', () => {
    const path = (label: string) => ITEMS.find((item) => item.label === label)?.path;

    // How this account behaves, how the workspace behaves, how the server behaves.
    expect(path('Preferences')).toBe('/settings');
    expect(path('Manage workspace')).toBe('/workspace');
    expect(path('Manage server')).toBe('/admin');
    expect(parseRoute('/workspace')).toEqual({ view: 'workspace', section: 'general' });
  });

  it('keeps the workspace and the server pages off a member menu', () => {
    for (const label of ['Manage workspace', 'Manage server']) {
      expect(ITEMS.find((item) => item.label === label)?.adminOnly).toBe(true);
    }
    // Preferences are everyone's, and hiding them from members would be the same bug
    // in the other direction.
    expect(ITEMS.find((item) => item.label === 'Preferences')?.adminOnly).toBeUndefined();
  });

  // The instance console reads past this workspace, so its endpoints are owner-gated.
  // An admin shown the link would find every page inside it answering 403.
  it('keeps the server console off an admin menu too', () => {
    expect(ITEMS.find((item) => item.label === 'Manage server')?.ownerOnly).toBe(true);
    expect(ITEMS.find((item) => item.label === 'Manage workspace')?.ownerOnly).toBeUndefined();
  });
});
