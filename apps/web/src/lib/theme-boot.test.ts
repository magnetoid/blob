// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'public/theme-boot.js'), 'utf8');

class MemoryStorage {
  constructor(private readonly value: unknown) {}

  getItem(key: string): string | null {
    return key === 'blob.theme' ? JSON.stringify(this.value) : null;
  }
}

function boot(saved: unknown, dark: boolean): void {
  const storage = new MemoryStorage(saved);
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
    ).toBe('#5fb287');
  });

  it('uses the current OS mode rather than the mode from the last session', () => {
    boot(
      {
        preference: 'system',
        mode: 'light',
        tokens: { '--accent': '#111111' },
        palettes: {
          light: { '--accent': '#111111' },
          dark: { '--accent': '#eeeeee', '--surface': '#222222' },
        },
      },
      true,
    );

    const root = document.documentElement;
    expect(root.dataset.resolvedTheme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.getPropertyValue('--accent')).toBe('#eeeeee');
    expect(root.dataset.themeTokens).toBe('--accent --surface');
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
        tokens: { '--accent': '#111111' },
      },
      true,
    );

    const root = document.documentElement;
    expect(root.dataset.resolvedTheme).toBe('dark');
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });

  it('honours an explicit mode independently of the OS', () => {
    boot(
      {
        preference: 'light',
        mode: 'light',
        tokens: { '--accent': '#123456' },
      },
      true,
    );

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.resolvedTheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(
      '#123456',
    );
  });
});
