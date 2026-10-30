// @vitest-environment happy-dom
/**
 * Settings → Preferences → palettes: each tile is drawn in the theme's own colours, read
 * from shadcn's names, and from b0 where a theme sets none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DEFAULT_PREFS, type Theme } from '@blob/shared';
import { useStore } from '../../lib/store.ts';
import { PreferencesCard } from './PreferencesCard.tsx';

function theme(slug: string, mode: Theme['mode'], tokens: Record<string, string>): Theme {
  return { id: slug, slug, name: slug, mode, tokens, isPreset: true, isEnabled: true };
}

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'me', displayName: 'Ana', prefs: { ...DEFAULT_PREFS } } as never,
    translationEnabled: false,
    themes: [
      theme('linen', 'light', {
        '--background': '#fbf8f3',
        '--sidebar': '#f4eee3',
        '--muted': '#f6f1e8',
        '--primary': '#7a4f22',
        // The names the stylesheet used before shadcn mean nothing to a tile now.
        '--bg': '#ff0000',
        '--accent': '#ff0000',
      }),
      theme('paper', 'light', {}),
      theme('midnight', 'dark', {}),
    ],
  } as never);
});

afterEach(cleanup);

function tile(name: string) {
  const root = document.querySelector(`.palette-tile[title="${name}"]`)!;
  const background = (selector: string) =>
    root.querySelector<HTMLElement>(selector)!.style.background;
  return {
    page: background('.palette-preview'),
    rail: background('.palette-preview-rail'),
    line: background('.palette-preview-line'),
    primary: background('.palette-preview-accent'),
  };
}

describe('the palette gallery', () => {
  it("draws a tile from the theme's page, sidebar, muted and primary colours", () => {
    render(<PreferencesCard />);

    expect(tile('linen')).toEqual({
      page: '#fbf8f3',
      rail: '#f4eee3',
      line: '#f6f1e8',
      primary: '#7a4f22',
    });
  });

  it("draws a theme that sets nothing in b0's colours for its mode", () => {
    render(<PreferencesCard />);

    expect(tile('paper')).toEqual({
      page: '#ffffff',
      rail: '#fafafa',
      line: '#f5f5f5',
      primary: '#171717',
    });
    expect(tile('midnight')).toEqual({
      page: '#0a0a0a',
      rail: '#171717',
      line: '#262626',
      primary: '#e5e5e5',
    });
  });
});
