import { contrastRatio as rgbContrast, parseColor } from './color.ts';

interface ContrastPair {
  foreground: string;
  background: string;
  minimum: number;
  label: string;
}

/**
 * The pairs a theme must keep readable, in shadcn's names — the ones themes are written
 * in. Message text, headings and labels all read `--foreground` now, and everything
 * quieter reads `--muted-foreground`, so two pairs on the page cover what four did.
 */
const PAIRS: ContrastPair[] = [
  {
    foreground: '--foreground',
    background: '--background',
    minimum: 4.5,
    label: 'primary text on page',
  },
  {
    foreground: '--muted-foreground',
    background: '--background',
    minimum: 4.5,
    label: 'secondary text on page',
  },
  {
    foreground: '--card-foreground',
    background: '--card',
    minimum: 4.5,
    label: 'primary text on surfaces',
  },
  {
    foreground: '--sidebar-foreground',
    background: '--sidebar',
    minimum: 4.5,
    label: 'primary text in the sidebar',
  },
  {
    foreground: '--primary-foreground',
    background: '--primary',
    minimum: 4.5,
    label: 'text on primary actions',
  },
  {
    foreground: '--destructive',
    background: '--background',
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
