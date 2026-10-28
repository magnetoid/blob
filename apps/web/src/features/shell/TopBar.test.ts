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
    const dead = ITEMS.filter(
      (item) => item.path && item.path !== '/' && parseRoute(item.path).view === 'messages',
    );
    expect(dead.map((item) => `${item.label} → ${item.path}`)).toEqual([]);
  });

  it('keeps your settings, the workspace console and the server console as three pages', () => {
    const path = (label: string) => ITEMS.find((item) => item.label === label)?.path;

    expect(path('Preferences')).toBe('/settings');
    expect(path('Workspace settings')).toBe('/admin');
    expect(path('Server')).toBe('/server');
    expect(parseRoute('/settings')).toEqual({ view: 'settings', section: 'preferences' });
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'general' });
    expect(parseRoute('/server')).toEqual({ view: 'server', section: 'health' });
  });

  it('keeps workspace settings off a member menu', () => {
    expect(ITEMS.find((item) => item.label === 'Workspace settings')?.adminOnly).toBe(true);
    expect(ITEMS.find((item) => item.label === 'Preferences')?.adminOnly).toBeUndefined();
  });

  it('lets an admin open the workspace console', () => {
    // Members, invitations and channels live here now, so an admin who is not the
    // owner still needs the link. Owner-only rows hide inside the console.
    expect(ITEMS.find((item) => item.label === 'Workspace settings')?.ownerOnly).toBeUndefined();
  });

  // A fact about the person, not a role: an owner who does not run the server never
  // sees it, and the server's admin sees it whatever their role in this workspace.
  it('offers the server console to its administrator alone', () => {
    const server = ITEMS.find((item) => item.label === 'Server');
    expect(server?.instanceOnly).toBe(true);
    expect(server?.adminOnly).toBeUndefined();
  });
});
