/**
 * Blob's custom properties and Tailwind's (and shadcn's) share one namespace.
 *
 * Blob's tokens are declared in the `legacy` layer, which ranks above the `theme` layer
 * Tailwind's own variables live in, so a Blob `--text-xs: 11px` would silently replace
 * Tailwind's `--text-xs` for every utility that reads it — and the same for shadcn's
 * `--accent`, `--radius` and `--sidebar-width`. The collision is invisible at review
 * time: both sides are legitimate CSS. A name Blob owns that Tailwind or shadcn also owns
 * therefore carries a `--blob-` prefix, and this test is what stops the next token from
 * drifting back.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = new URL('../..', import.meta.url).pathname;
const STYLES = join(WEB, 'src/styles');

/** Every `--name:` a stylesheet declares. Comments go first: Blob's prose names tokens. */
function declared(css: string): Set<string> {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set<string>();
  for (const match of code.matchAll(/(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) {
    names.add(match[1]!);
  }
  return names;
}

function blobTokens(): Set<string> {
  const files = [
    join(STYLES, 'tokens.css'),
    join(STYLES, 'app.css'),
    ...readdirSync(join(STYLES, 'app'))
      .filter((file) => file.endsWith('.css'))
      .map((file) => join(STYLES, 'app', file)),
  ];
  const names = new Set<string>();
  for (const file of files) {
    for (const name of declared(readFileSync(file, 'utf8'))) names.add(name);
  }
  return names;
}

/**
 * The variables shadcn's components read, from its `new-york` theme and its sidebar
 * block. Tailwind's own come out of the installed package so a new release cannot add a
 * name this list does not know about.
 */
const SHADCN = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--border',
  '--input',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--radius',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--sidebar-width',
  '--sidebar-width-icon',
  '--sidebar-width-mobile',
];

describe('Blob design tokens', () => {
  it('declares no token that Tailwind or shadcn also declares', () => {
    const tailwind = declared(
      readFileSync(join(WEB, 'node_modules/tailwindcss/theme.css'), 'utf8'),
    );
    // Guard the guard: an empty theme would make the intersection trivially empty.
    expect(tailwind.size).toBeGreaterThan(300);
    expect(tailwind.has('--text-xs')).toBe(true);

    const reserved = new Set([...tailwind, ...SHADCN]);
    const collisions = [...blobTokens()].filter((name) => reserved.has(name)).sort();

    expect(collisions).toEqual([]);
  });
});

/**
 * The stylesheet's shape is a promise too. Tailwind's `source(none)` and its `@source`
 * list decide which files its utilities are generated from, and the `legacy` layer is
 * what keeps Blob's own CSS ranked above preflight and below a converted component's
 * utilities. Both fail quietly: a stray scan root only makes the sheet bigger, and a
 * legacy import with no layer only changes who wins a tie.
 */
describe('styles/index.css', () => {
  /** Comments go first: the file's own prose names `@source` and `@layer`. */
  const indexCss = () =>
    readFileSync(join(STYLES, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * Directories Tailwind may scan, relative to `src/`. A phase that converts a path adds
   * it here in the same commit as its `@source` — the point of the list is that adding
   * one is deliberate.
   */
  const CONVERTED = ['components/ui'];

  it('scans only converted paths', () => {
    const css = indexCss();
    expect(css).toMatch(/@import\s+"tailwindcss"\s+source\(none\)/);

    const sources = [...css.matchAll(/@source\s+(?:not\s+)?"([^"]+)"/g)].map((m) => m[1]!);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const fromSrc = relative(join(WEB, 'src'), resolve(STYLES, source));
      expect(CONVERTED.some((dir) => fromSrc === dir || fromSrc.startsWith(`${dir}/`))).toBe(true);
    }
  });

  it('puts the legacy stylesheets in their own layer, ranked between preflight and utilities', () => {
    const css = indexCss();
    const order = css.match(/^@layer\s+([^;{]+);/m);
    expect(order?.[1]?.split(',').map((name) => name.trim())).toEqual([
      'theme',
      'base',
      'legacy',
      'components',
      'utilities',
    ]);
    // The statement has to precede every import, or the order it declares is not the one
    // the browser sees.
    expect(css.indexOf('@layer')).toBeLessThan(css.indexOf('@import'));

    expect(css).toMatch(/@import\s+"\.\/tokens\.css"\s+layer\(legacy\)/);
    expect(css).toMatch(/@import\s+"\.\/app\.css"\s+layer\(legacy\)/);
  });
});
