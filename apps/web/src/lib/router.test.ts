import { describe, expect, it } from 'vitest';
import {
  ADMIN_DETAIL_SECTIONS,
  ADMIN_SECTIONS,
  WORKSPACE_DETAIL_SECTIONS,
  WORKSPACE_SECTIONS,
  parseRoute,
  pathForRoute,
  pathForView,
  type Route,
} from './router.ts';

describe('parseRoute', () => {
  it('reads the top-level views', () => {
    expect(parseRoute('/')).toEqual({ view: 'messages' });
    expect(parseRoute('/search')).toEqual({ view: 'search' });
    expect(parseRoute('/threads')).toEqual({ view: 'threads' });
    // Preferences are a section of the workspace page now, not a view of their own.
    expect(parseRoute('/settings')).toEqual({ view: 'workspace', section: 'preferences' });
  });

  it('defaults bare /admin to the first section', () => {
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'users' });
  });

  it('reads every admin section', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(parseRoute(`/admin/${section}`)).toEqual({ view: 'admin', section });
    }
  });

  it('ignores a trailing slash', () => {
    expect(parseRoute('/admin/audit/')).toEqual({ view: 'admin', section: 'audit' });
    expect(parseRoute('/search//')).toEqual({ view: 'search' });
  });

  // A bad link should land somewhere usable, not on a blank pane.
  it('falls back to messages for anything unknown', () => {
    expect(parseRoute('/admin/nonsense')).toEqual({ view: 'messages' });
    expect(parseRoute('/join/some-token')).toEqual({ view: 'messages' });
    expect(parseRoute('/nope')).toEqual({ view: 'messages' });
  });

  it('reads a detail page under a section that has one', () => {
    expect(parseRoute('/admin/users/u123')).toEqual({
      view: 'admin',
      section: 'users',
      detailId: 'u123',
    });
    expect(parseRoute('/workspace/members/u123')).toEqual({
      view: 'workspace',
      section: 'members',
      detailId: 'u123',
    });
  });

  // The second segment is only meaningful where a detail page exists. Elsewhere it is a
  // malformed link, and rendering the list while ignoring half the URL hides that.
  it('refuses a detail id on a section without detail pages', () => {
    expect(parseRoute('/admin/audit/u123')).toEqual({ view: 'messages' });
    expect(parseRoute('/workspace/general/anything')).toEqual({ view: 'messages' });
  });

  it('never reads more than two segments', () => {
    expect(parseRoute('/admin/users/u123/extra')).toEqual({ view: 'messages' });
  });

  // Personal and workspace settings are now one page; the server console is still its
  // own. What must not collide is the two *pages*, and the old personal URL.
  it('keeps your settings and the server console apart, and folds the old URL in', () => {
    expect(parseRoute('/settings')).toEqual({ view: 'workspace', section: 'preferences' });
    expect(parseRoute('/workspace')).toEqual({ view: 'workspace', section: 'general' });
    expect(parseRoute('/workspace/preferences')).toEqual({
      view: 'workspace',
      section: 'preferences',
    });
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'users' });
  });

  // Every one of these was a real, linkable URL before the workspace/instance split, so
  // they redirect instead of dead-ending on the conversation.
  it('sends the old admin URLs to where those pages went', () => {
    expect(parseRoute('/admin/settings')).toEqual({ view: 'workspace', section: 'general' });
    expect(parseRoute('/admin/themes')).toEqual({ view: 'workspace', section: 'appearance' });
    expect(parseRoute('/admin/people')).toEqual({ view: 'workspace', section: 'members' });
    expect(parseRoute('/admin/invitations')).toEqual({
      view: 'workspace',
      section: 'invitations',
    });
    expect(parseRoute('/admin/channels')).toEqual({ view: 'workspace', section: 'channels' });
    expect(parseRoute('/admin/apps')).toEqual({ view: 'workspace', section: 'apps' });
    expect(parseRoute('/admin/webhooks')).toEqual({ view: 'workspace', section: 'webhooks' });
  });

  it('carries a detail id across the move', () => {
    // A link to one person or one app keeps working, pointing at the same thing.
    expect(parseRoute('/admin/people/u123')).toEqual({
      view: 'workspace',
      section: 'members',
      detailId: 'u123',
    });
    expect(parseRoute('/admin/apps/p9')).toEqual({
      view: 'workspace',
      section: 'apps',
      detailId: 'p9',
    });
  });

  it('reads every workspace section, and refuses one that does not exist', () => {
    for (const section of WORKSPACE_SECTIONS) {
      expect(parseRoute(`/workspace/${section}`)).toEqual({ view: 'workspace', section });
    }
    expect(parseRoute('/workspace/invented')).toEqual({ view: 'messages' });
  });
});

describe('pathForRoute', () => {
  it('round-trips every route', () => {
    const routes: Route[] = [
      { view: 'messages' },
      { view: 'search' },
      { view: 'threads' },
      ...WORKSPACE_SECTIONS.map((section) => ({ view: 'workspace' as const, section })),
      ...ADMIN_SECTIONS.map((section) => ({ view: 'admin' as const, section })),
      ...ADMIN_DETAIL_SECTIONS.map((section) => ({
        view: 'admin' as const,
        section,
        detailId: 'abc123',
      })),
      ...WORKSPACE_SECTIONS.map((section) => ({ view: 'workspace' as const, section })),
      ...WORKSPACE_DETAIL_SECTIONS.map((section) => ({
        view: 'workspace' as const,
        section,
        detailId: 'abc123',
      })),
    ];
    for (const route of routes) {
      expect(parseRoute(pathForRoute(route))).toEqual(route);
    }
  });

  it('sends the admin rail button to the first section', () => {
    expect(pathForView('admin')).toBe('/admin/users');
    expect(pathForView('workspace')).toBe('/workspace/general');
    expect(pathForView('messages')).toBe('/');
  });
});
