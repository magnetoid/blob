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

  it('keeps your settings and the server console as two pages', () => {
    const path = (label: string) => ITEMS.find((item) => item.label === label)?.path;

    expect(path('Preferences')).toBe('/settings');
    expect(path('Server settings')).toBe('/admin');
    expect(parseRoute('/settings')).toEqual({ view: 'settings', section: 'preferences' });
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'general' });
  });

  it('keeps server settings off a member menu', () => {
    expect(ITEMS.find((item) => item.label === 'Server settings')?.adminOnly).toBe(true);
    expect(ITEMS.find((item) => item.label === 'Preferences')?.adminOnly).toBeUndefined();
  });

  it('lets an admin open the merged server page', () => {
    // Members, invitations and channels live here now, so an admin who is not the
    // owner still needs the link. Owner-only rows hide inside the console.
    expect(ITEMS.find((item) => item.label === 'Server settings')?.ownerOnly).toBeUndefined();
  });
});
