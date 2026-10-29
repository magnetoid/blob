// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Theme, UserPrefs } from '@blob/shared';
import { applyTheme, pickTheme, resolveMode, themeChoices } from './theme.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const prefs: Pick<UserPrefs, 'theme' | 'themeLight' | 'themeDark'> = {
  theme: 'system',
  themeLight: 'paper',
  themeDark: 'midnight',
};

function theme(
  slug: string,
  mode: Theme['mode'],
  tokens: Record<string, string>,
): Theme {
  return {
    id: slug,
    slug,
    name: slug,
    mode,
    tokens,
    isPreset: true,
    isEnabled: true,
  };
}

function setSystemDark(dark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-resolved-theme');
  document.documentElement.removeAttribute('data-theme-tokens');
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  setSystemDark(false);
});

describe('theme selection', () => {
  const themes = [
    theme('paper', 'light', { '--primary': '#123456' }),
    theme('midnight', 'dark', { '--primary': '#abcdef' }),
  ];

  it('resolves system mode against the current OS setting', () => {
    expect(resolveMode('system')).toBe('light');
    setSystemDark(true);
    expect(resolveMode('system')).toBe('dark');
  });

  it('keeps independent light and dark palettes ready for no-flash boot', () => {
    expect(themeChoices(themes, prefs)).toEqual({
      light: { mode: 'light', tokens: { '--primary': '#123456' } },
      dark: { mode: 'dark', tokens: { '--primary': '#abcdef' } },
    });
  });

  it('falls back to an enabled palette of the requested mode', () => {
    const disabled = {
      ...theme('disabled', 'dark', { '--primary': '#000000' }),
      isEnabled: false,
    };
    expect(
      pickTheme([...themes, disabled], {
        ...prefs,
        theme: 'dark',
        themeDark: 'disabled',
      }),
    ).toEqual({ mode: 'dark', tokens: { '--primary': '#abcdef' } });
  });
});

describe('theme application', () => {
  it('removes stale boot tokens and updates browser chrome atomically', () => {
    const root = document.documentElement;
    root.dataset.themeTokens = '--primary --card';
    root.style.setProperty('--primary', '#ff0000');
    root.style.setProperty('--card', '#ffffff');

    applyTheme({ mode: 'dark', tokens: { '--primary': '#abcdef' } }, 'dark');

    expect(root.style.getPropertyValue('--card')).toBe('');
    expect(root.style.getPropertyValue('--primary')).toBe('#abcdef');
    expect(root.dataset.themeTokens).toBe('--primary');
    expect(root.dataset.resolvedTheme).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(chrome()).toBe('#abcdef');
  });

  it("draws browser chrome from --primary, and b0's when a theme sets none", () => {
    applyTheme({ mode: 'light', tokens: {} }, 'light');
    expect(chrome()).toBe('#171717');

    applyTheme({ mode: 'dark', tokens: {} }, 'dark');
    expect(chrome()).toBe('#e5e5e5');

    applyTheme({ mode: 'light', tokens: { '--primary': '#7a4f22' } }, 'light');
    expect(chrome()).toBe('#7a4f22');
  });

  it('gives browser chrome a hex even when the theme is written in oklch', () => {
    // Not every engine reads oklch() in a <meta>, and shadcn's own palette is oklch.
    applyTheme({ mode: 'light', tokens: { '--primary': 'oklch(0.205 0 0)' } }, 'light');
    expect(chrome()).toBe('#171717');

    // A value that is not a literal colour is as good as none.
    applyTheme({ mode: 'light', tokens: { '--primary': 'var(--ring)' } }, 'light');
    expect(chrome()).toBe('#171717');
  });

  it('persists both mode palettes for the pre-hydration boot script', () => {
    const choices = {
      light: { mode: 'light' as const, tokens: { '--primary': '#123456' } },
      dark: { mode: 'dark' as const, tokens: { '--primary': '#abcdef' } },
    };

    applyTheme(choices.light, 'system', choices);

    expect(
      JSON.parse(window.localStorage.getItem('blob.theme.v2') ?? ''),
    ).toEqual({
      preference: 'system',
      mode: 'light',
      tokens: choices.light.tokens,
      palettes: {
        light: choices.light.tokens,
        dark: choices.dark.tokens,
      },
    });
  });

  it('lets go of the palette kept under the old key', () => {
    window.localStorage.setItem('blob.theme', '{"tokens":{"--accent":"#1f5c3d"}}');

    applyTheme({ mode: 'light', tokens: {} }, 'light');

    expect(window.localStorage.getItem('blob.theme')).toBeNull();
    expect(window.localStorage.getItem('blob.theme.v2')).not.toBeNull();
  });
});

function chrome(): string | undefined {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;
}
