import { contrastRatio as rgbContrast, parseColor } from './color.ts';

interface ContrastPair {
  foreground: string;
  background: string;
  minimum: number;
  label: string;
}

const PAIRS: ContrastPair[] = [
  {
    foreground: '--text',
    background: '--bg',
    minimum: 4.5,
    label: 'primary text on page',
  },
  {
    foreground: '--text-body',
    background: '--bg',
    minimum: 4.5,
    label: 'message text on page',
  },
  {
    foreground: '--text-2',
    background: '--bg',
    minimum: 4.5,
    label: 'secondary text on page',
  },
  {
    foreground: '--text-faint',
    background: '--bg',
    minimum: 4.5,
    label: 'faint text on page',
  },
  {
    foreground: '--text',
    background: '--surface',
    minimum: 4.5,
    label: 'primary text on surfaces',
  },
  {
    foreground: '--text',
    background: '--bg-sidebar',
    minimum: 4.5,
    label: 'primary text in the sidebar',
  },
  {
    foreground: '--accent-contrast',
    background: '--accent',
    minimum: 4.5,
    label: 'text on primary actions',
  },
  {
    foreground: '--danger',
    background: '--bg',
    minimum: 4.5,
    label: 'danger text on page',
  },
];

/**
 * WCAG contrast of two colour strings, as the theme editor holds them. A value that is
 * not a literal colour scores 1 — reported as unreadable rather than passed unseen.
 */
export function contrastRatio(foreground: string, background: string): number {
  const foregroundRgb = parseColor(foreground);
  const backgroundRgb = parseColor(background);
  if (!foregroundRgb || !backgroundRgb) return 1;
  return rgbContrast(foregroundRgb, backgroundRgb);
}

export function themeContrastIssues(tokens: Record<string, string>): string[] {
  return PAIRS.flatMap((pair) => {
    const foreground = tokens[pair.foreground];
    const background = tokens[pair.background];
    if (!foreground || !background) return [];
    const ratio = contrastRatio(foreground, background);
    return ratio < pair.minimum
      ? [`${pair.label} is ${ratio.toFixed(2)}:1; it needs ${pair.minimum}:1`]
      : [];
  });
}
