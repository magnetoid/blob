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
        '--bg': '#ffffff',
        '--surface': '#ffffff',
        '--bg-sidebar': '#f2f2f2',
        '--text': '#000000',
        '--text-body': '#111111',
        '--text-2': '#333333',
        '--text-faint': '#555555',
        '--accent': '#0b4f2f',
        '--accent-contrast': '#ffffff',
        '--danger': '#8a1c12',
      }),
    ).toEqual([]);
  });

  it('names unreadable semantic pairs', () => {
    const issues = themeContrastIssues({
      '--bg': '#ffffff',
      '--text': '#eeeeee',
      '--accent': '#eeeeee',
      '--accent-contrast': '#ffffff',
    });

    expect(issues).toContain('primary text on page is 1.16:1; it needs 4.5:1');
    expect(issues).toContain(
      'text on primary actions is 1.16:1; it needs 4.5:1',
    );
  });
});
