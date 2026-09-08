import { describe, expect, it } from 'vitest';
import {
  ADMIN_DETAIL_SECTIONS,
  ADMIN_SECTIONS,
  SETTINGS_SECTIONS,
  parseRoute,
  pathForRoute,
  pathForView,
  type Route,
  pathForChannel,
} from './router.ts';

describe('parseRoute', () => {
  it('reads the top-level views', () => {
    expect(parseRoute('/')).toEqual({ view: 'home' });
    expect(parseRoute('/home')).toEqual({ view: 'home' });
    expect(parseRoute('/search')).toEqual({ view: 'search' });
    expect(parseRoute('/threads')).toEqual({ view: 'threads' });
    expect(parseRoute('/later')).toEqual({ view: 'saved' });
    expect(parseRoute('/m/abc123')).toEqual({ view: 'permalink', messageId: 'abc123' });
    expect(parseRoute('/help')).toEqual({ view: 'help' });
    expect(parseRoute('/settings')).toEqual({ view: 'settings', section: 'preferences' });
  });

  it('defaults bare /admin to general', () => {
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'general' });
  });

  it('reads every admin section', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(parseRoute(`/admin/${section}`)).toEqual({ view: 'admin', section });
    }
  });

  it('reads every settings section', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(parseRoute(`/settings/${section}`)).toEqual({ view: 'settings', section });
    }
  });

  it('ignores a trailing slash', () => {
    expect(parseRoute('/admin/audit/')).toEqual({ view: 'admin', section: 'audit' });
    expect(parseRoute('/search//')).toEqual({ view: 'search' });
  });

  it('falls back to messages for anything unknown', () => {
    expect(parseRoute('/admin/nonsense')).toEqual({ view: 'messages' });
    expect(parseRoute('/join/some-token')).toEqual({ view: 'messages' });
    expect(parseRoute('/nope')).toEqual({ view: 'messages' });
    expect(parseRoute('/m')).toEqual({ view: 'messages' });
    expect(parseRoute('/m/abc/extra')).toEqual({ view: 'messages' });
  });

  it('reads a detail page under a section that has one', () => {
    expect(parseRoute('/admin/users/u123')).toEqual({
      view: 'admin',
      section: 'users',
      detailId: 'u123',
    });
    expect(parseRoute('/admin/members/u123')).toEqual({
      view: 'admin',
      section: 'members',
      detailId: 'u123',
    });
  });

  it('refuses a detail id on a section without detail pages', () => {
    expect(parseRoute('/admin/audit/u123')).toEqual({ view: 'messages' });
    expect(parseRoute('/admin/general/anything')).toEqual({ view: 'messages' });
  });

  it('never reads more than two segments', () => {
    expect(parseRoute('/admin/users/u123/extra')).toEqual({ view: 'messages' });
  });

  it('keeps your settings and the server console apart', () => {
    expect(parseRoute('/settings')).toEqual({ view: 'settings', section: 'preferences' });
    expect(parseRoute('/admin')).toEqual({ view: 'admin', section: 'general' });
  });

  it('sends old /workspace URLs to the page that owns them now', () => {
    expect(parseRoute('/workspace')).toEqual({ view: 'admin', section: 'general' });
    expect(parseRoute('/workspace/preferences')).toEqual({
      view: 'settings',
      section: 'preferences',
    });
    expect(parseRoute('/workspace/general')).toEqual({ view: 'admin', section: 'general' });
    expect(parseRoute('/workspace/members/u123')).toEqual({
      view: 'admin',
      section: 'members',
      detailId: 'u123',
    });
    expect(parseRoute('/workspace/invented')).toEqual({ view: 'messages' });
  });

  it('sends the older admin aliases to the merged console', () => {
    expect(parseRoute('/admin/settings')).toEqual({ view: 'admin', section: 'general' });
    expect(parseRoute('/admin/themes')).toEqual({ view: 'admin', section: 'appearance' });
    expect(parseRoute('/admin/people')).toEqual({ view: 'admin', section: 'members' });
    expect(parseRoute('/admin/people/u123')).toEqual({
      view: 'admin',
      section: 'members',
      detailId: 'u123',
    });
    expect(parseRoute('/admin/workspaces')).toEqual({ view: 'admin', section: 'general' });
    expect(parseRoute('/admin/invitations')).toEqual({ view: 'admin', section: 'invitations' });
    expect(parseRoute('/admin/channels')).toEqual({ view: 'admin', section: 'channels' });
    expect(parseRoute('/admin/apps')).toEqual({ view: 'admin', section: 'apps' });
    expect(parseRoute('/admin/webhooks')).toEqual({ view: 'admin', section: 'webhooks' });
  });
});

describe('pathForRoute', () => {
  it('round-trips every route', () => {
    const routes: Route[] = [
      { view: 'home' },
      { view: 'search' },
      { view: 'threads' },
      { view: 'activity' },
      { view: 'saved' },
      { view: 'help' },
      { view: 'permalink', messageId: 'abc123' },
      ...SETTINGS_SECTIONS.map((section) => ({ view: 'settings' as const, section })),
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

  it('sends the rail buttons to the first section of each page', () => {
    expect(pathForView('admin')).toBe('/admin/general');
    expect(pathForView('settings')).toBe('/settings/preferences');
    expect(pathForView('home')).toBe('/');
  });
});

describe('channel routes', () => {
  it('reads a channel address', () => {
    expect(parseRoute('/c/abc-123')).toEqual({ view: 'channel', channelId: 'abc-123' });
  });

  it('reads a channel with an open thread', () => {
    expect(parseRoute('/c/abc/t/root-9')).toEqual({
      view: 'channel',
      channelId: 'abc',
      threadRootId: 'root-9',
    });
  });

  it('round-trips through pathForRoute', () => {
    for (const route of [
      { view: 'channel', channelId: 'c1' } as const,
      { view: 'channel', channelId: 'c1', threadRootId: 't1' } as const,
    ]) {
      expect(parseRoute(pathForRoute(route))).toEqual(route);
    }
  });

  it('emits the same paths pathForChannel does', () => {
    expect(pathForChannel('c1')).toBe('/c/c1');
    expect(pathForChannel('c1', 't2')).toBe('/c/c1/t/t2');
  });

  it('a malformed channel path falls back to the conversation', () => {
    expect(parseRoute('/c/')).toEqual({ view: 'messages' });
    expect(parseRoute('/c/a/b')).toEqual({ view: 'messages' });
    expect(parseRoute('/c/a/t/')).toEqual({ view: 'messages' });
  });
});
