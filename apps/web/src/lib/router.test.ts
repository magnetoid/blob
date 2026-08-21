import { describe, expect, it } from 'vitest';
import {
  ADMIN_DETAIL_SECTIONS,
  ADMIN_SECTIONS,
  parseRoute,
  pathForRoute,
  pathForView,
  type Route,
} from './router.ts';

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
    expect(parseRoute('/join/some-token')).toEqual({ view: 'messages' });
    expect(parseRoute('/nope')).toEqual({ view: 'messages' });
  });

  it('reads a detail page under a section that has one', () => {
    expect(parseRoute('/admin/people/u123')).toEqual({
      view: 'admin',
      section: 'people',
      detailId: 'u123',
    });
  });

  // The second segment is only meaningful where a detail page exists. Elsewhere it is a
  // malformed link, and rendering the list while ignoring half the URL hides that.
  it('refuses a detail id on a section without detail pages', () => {
    expect(parseRoute('/admin/audit/u123')).toEqual({ view: 'messages' });
    expect(parseRoute('/admin/settings/anything')).toEqual({ view: 'messages' });
  });

  it('never reads more than two segments', () => {
    expect(parseRoute('/admin/people/u123/extra')).toEqual({ view: 'messages' });
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
      ...ADMIN_DETAIL_SECTIONS.map((section) => ({
        view: 'admin' as const,
        section,
        detailId: 'abc123',
      })),
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
