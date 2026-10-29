// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'public/theme-boot.js'), 'utf8');

class MemoryStorage {
  constructor(private readonly values: Record<string, unknown>) {}

  getItem(key: string): string | null {
    return key in this.values ? JSON.stringify(this.values[key]) : null;
  }
}

/** The palette is kept under this key; `blob.theme` held the pre-shadcn names. */
const KEY = 'blob.theme.v2';

function boot(
  saved: unknown,
  dark: boolean,
  values: Record<string, unknown> = saved === null ? {} : { [KEY]: saved },
): void {
  const storage = new MemoryStorage(values);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: dark }),
  });
  new Function('window', 'document', 'localStorage', source)(
    window,
    document,
    storage,
  );
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-resolved-theme');
  document.documentElement.removeAttribute('data-theme-tokens');
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
});

describe('pre-hydration theme boot', () => {
  it('matches browser chrome to a first dark visit without cached preferences', () => {
    boot(null, true);

    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    ).toBe('#e5e5e5');
  });

  it('ignores a palette stored under the old key', () => {
    // `blob.theme` held `--accent` and `--bg`. `--accent` is now shadcn's hover wash, so
    // replaying it would paint every hover in the old brand colour until the first save.
    boot(
      null,
      false,
      {
        'blob.theme': {
          preference: 'light',
          mode: 'light',
          tokens: { '--accent': '#1f5c3d' },
          palettes: { light: { '--accent': '#1f5c3d' }, dark: {} },
        },
      },
    );

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.length).toBe(0);
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.hasAttribute('data-theme-tokens')).toBe(false);
  });

  it('reads the palette stored under the v2 key', () => {
    boot(
      {
        preference: 'light',
        mode: 'light',
        tokens: { '--primary': '#7a4f22', '--background': '#fbf8f3' },
      },
      false,
    );

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--primary')).toBe('#7a4f22');
    expect(root.style.getPropertyValue('--background')).toBe('#fbf8f3');
    expect(root.dataset.themeTokens).toBe('--primary --background');
  });

  it('takes browser chrome from --primary, and falls back to b0\'s', () => {
    const chrome = () =>
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;

    boot({ preference: 'light', mode: 'light', tokens: { '--primary': '#7a4f22' } }, false);
    expect(chrome()).toBe('#7a4f22');

    boot({ preference: 'light', mode: 'light', tokens: {} }, false);
    expect(chrome()).toBe('#171717');

    boot({ preference: 'dark', mode: 'dark', tokens: {} }, false);
    expect(chrome()).toBe('#e5e5e5');
  });

  it('uses the current OS mode rather than the mode from the last session', () => {
    boot(
      {
        preference: 'system',
        mode: 'light',
        tokens: { '--primary': '#111111' },
        palettes: {
          light: { '--primary': '#111111' },
          dark: { '--primary': '#eeeeee', '--card': '#222222' },
        },
      },
      true,
    );

    const root = document.documentElement;
    expect(root.dataset.resolvedTheme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.getPropertyValue('--primary')).toBe('#eeeeee');
    expect(root.dataset.themeTokens).toBe('--primary --card');
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe('#eeeeee');
  });

  it('does not replay a legacy palette into the wrong system mode', () => {
    boot(
      {
        preference: 'system',
        mode: 'light',
        tokens: { '--primary': '#111111' },
      },
      true,
    );

    const root = document.documentElement;
    expect(root.dataset.resolvedTheme).toBe('dark');
    expect(root.style.getPropertyValue('--primary')).toBe('');
  });

  it('honours an explicit mode independently of the OS', () => {
    boot(
      {
        preference: 'light',
        mode: 'light',
        tokens: { '--primary': '#123456' },
      },
      true,
    );

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.resolvedTheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(
      '#123456',
    );
  });
});
