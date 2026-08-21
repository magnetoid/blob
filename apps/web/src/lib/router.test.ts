import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, parseRoute, pathForRoute, pathForView, type Route } from './router.ts';

describe('parseRoute', () => {
  it('reads the top-level views', () => {
    expect(parseRoute('/')).toEqual({ view: 'messages' });
    expect(parseRoute('/search')).toEqual({ view: 'search' });
    expect(parseRoute('/settings')).toEqual({ view: 'settings' });
  });

  it('defaults bare /admin to the first section', () => {
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'people' });
  });

  it('reads every admin section', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(parseRoute(`/admin/${section}`)).toEqual({ view: 'admin', section });
    }
  });

  it('ignores a trailing slash', () => {
    expect(parseRoute('/admin/apps/')).toEqual({ view: 'admin', section: 'apps' });
    expect(parseRoute('/search//')).toEqual({ view: 'search' });
  });

  // A bad link should land somewhere usable, not on a blank pane.
  it('falls back to messages for anything unknown', () => {
    expect(parseRoute('/admin/nonsense')).toEqual({ view: 'messages' });
    expect(parseRoute('/admin/people/extra')).toEqual({ view: 'messages' });
    expect(parseRoute('/join/some-token')).toEqual({ view: 'messages' });
    expect(parseRoute('/nope')).toEqual({ view: 'messages' });
  });

  // 'settings' names both a top-level view and an admin section; they must not collide.
  it('keeps /settings and /admin/settings apart', () => {
    expect(parseRoute('/settings')).toEqual({ view: 'settings' });
    expect(parseRoute('/admin/settings')).toEqual({ view: 'admin', section: 'settings' });
  });
});

describe('pathForRoute', () => {
  it('round-trips every route', () => {
    const routes: Route[] = [
      { view: 'messages' },
      { view: 'search' },
      { view: 'settings' },
      ...ADMIN_SECTIONS.map((section) => ({ view: 'admin' as const, section })),
    ];
    for (const route of routes) {
      expect(parseRoute(pathForRoute(route))).toEqual(route);
    }
  });

  it('sends the admin rail button to the first section', () => {
    expect(pathForView('admin')).toBe('/admin/people');
    expect(pathForView('messages')).toBe('/');
  });
});
