import { describe, expect, it } from 'vitest';
import { contrastRatio, themeContrastIssues } from './themeContrast.ts';

describe('theme contrast', () => {
  it('uses the WCAG relative-luminance ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('rgb(0 0 0 / 50%)', '#ffffff')).toBeCloseTo(3.98, 1);
  });

  it('accepts a readable semantic palette', () => {
    expect(
      themeContrastIssues({
        '--background': '#ffffff',
        '--card': '#ffffff',
        '--sidebar': '#f2f2f2',
        '--foreground': '#000000',
        '--card-foreground': '#111111',
        '--muted-foreground': '#555555',
        '--sidebar-foreground': '#000000',
        '--primary': '#0b4f2f',
        '--primary-foreground': '#ffffff',
        '--destructive': '#8a1c12',
      }),
    ).toEqual([]);
  });

  it('accepts an oklch palette, which is how shadcn writes its own', () => {
    expect(
      themeContrastIssues({
        '--background': 'oklch(1 0 0)',
        '--card': 'oklch(1 0 0)',
        '--sidebar': 'oklch(0.985 0 0)',
        '--foreground': 'oklch(0.145 0 0)',
        '--card-foreground': 'oklch(0.145 0 0)',
        '--muted-foreground': 'oklch(0.54 0 0)',
        '--sidebar-foreground': 'oklch(0.145 0 0)',
        '--primary': 'oklch(0.205 0 0)',
        '--primary-foreground': 'oklch(0.985 0 0)',
        '--destructive': 'oklch(0.577 0.245 27.325)',
      }),
    ).toEqual([]);
  });

  it('measures an unreadable oklch pair as well as a hex one', () => {
    const issues = themeContrastIssues({
      '--background': 'oklch(1 0 0)',
      '--muted-foreground': 'oklch(0.9 0 0)',
    });
    expect(issues).toEqual([
      expect.stringMatching(/^secondary text on page is 1\.\d\d:1; it needs 4\.5:1$/),
    ]);
  });

  it('does not read the keys the stylesheet used before shadcn', () => {
    // `--accent` is shadcn's hover wash now, `--bg` and `--text` are bridge names: a
    // palette written in them is not a palette this check knows how to read.
    expect(
      themeContrastIssues({
        '--bg': '#ffffff',
        '--text': '#eeeeee',
        '--accent': '#eeeeee',
        '--accent-contrast': '#ffffff',
      }),
    ).toEqual([]);
  });

  it('names unreadable semantic pairs', () => {
    const issues = themeContrastIssues({
      '--background': '#ffffff',
      '--foreground': '#eeeeee',
      '--primary': '#eeeeee',
      '--primary-foreground': '#ffffff',
      '--sidebar': '#ffffff',
      '--sidebar-foreground': '#eeeeee',
      '--destructive': '#eeeeee',
    });

    expect(issues).toContain('primary text on page is 1.16:1; it needs 4.5:1');
    expect(issues).toContain(
      'text on primary actions is 1.16:1; it needs 4.5:1',
    );
    expect(issues).toContain(
      'primary text in the sidebar is 1.16:1; it needs 4.5:1',
    );
    expect(issues).toContain('danger text on page is 1.16:1; it needs 4.5:1');
  });
});
