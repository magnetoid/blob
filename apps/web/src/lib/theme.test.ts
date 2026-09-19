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
    theme('paper', 'light', { '--accent': '#123456' }),
    theme('midnight', 'dark', { '--accent': '#abcdef' }),
  ];

  it('resolves system mode against the current OS setting', () => {
    expect(resolveMode('system')).toBe('light');
    setSystemDark(true);
    expect(resolveMode('system')).toBe('dark');
  });

  it('keeps independent light and dark palettes ready for no-flash boot', () => {
    expect(themeChoices(themes, prefs)).toEqual({
      light: { mode: 'light', tokens: { '--accent': '#123456' } },
      dark: { mode: 'dark', tokens: { '--accent': '#abcdef' } },
    });
  });

  it('falls back to an enabled palette of the requested mode', () => {
    const disabled = {
      ...theme('disabled', 'dark', { '--accent': '#000000' }),
      isEnabled: false,
    };
    expect(
      pickTheme([...themes, disabled], {
        ...prefs,
        theme: 'dark',
        themeDark: 'disabled',
      }),
    ).toEqual({ mode: 'dark', tokens: { '--accent': '#abcdef' } });
  });
});

describe('theme application', () => {
  it('removes stale boot tokens and updates browser chrome atomically', () => {
    const root = document.documentElement;
    root.dataset.themeTokens = '--accent --surface';
    root.style.setProperty('--accent', '#ff0000');
    root.style.setProperty('--surface', '#ffffff');

    applyTheme({ mode: 'dark', tokens: { '--accent': '#abcdef' } }, 'dark');

    expect(root.style.getPropertyValue('--surface')).toBe('');
    expect(root.style.getPropertyValue('--accent')).toBe('#abcdef');
    expect(root.dataset.themeTokens).toBe('--accent');
    expect(root.dataset.resolvedTheme).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe('#abcdef');
  });

  it('persists both mode palettes for the pre-hydration boot script', () => {
    const choices = {
      light: { mode: 'light' as const, tokens: { '--accent': '#123456' } },
      dark: { mode: 'dark' as const, tokens: { '--accent': '#abcdef' } },
    };

    applyTheme(choices.light, 'system', choices);

    expect(JSON.parse(window.localStorage.getItem('blob.theme') ?? '')).toEqual(
      {
        preference: 'system',
        mode: 'light',
        tokens: choices.light.tokens,
        palettes: {
          light: choices.light.tokens,
          dark: choices.dark.tokens,
        },
      },
    );
  });
});
