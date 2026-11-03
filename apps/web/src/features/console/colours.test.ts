/**
 * The consoles take every colour from the theme.
 *
 * A workspace theme is a set of shadcn's colour names (plus Blob's few extras) written on
 * `<html>` (`lib/theme.ts`), so anything painted through `var(--…)` or a theme utility —
 * `bg-card`, `text-muted-foreground` — repaints with it. A literal does not: a `#fff`, an
 * `oklch(…)`, or one of Tailwind's own palette colours (`bg-red-500`) stays that colour on
 * Midnight, Linen and every custom theme, and nothing fails until somebody looks.
 *
 * Read as text, with comments gone, since the prose names colours to explain them. Tests
 * are left out: their fixtures are themes, which are made of literal colours.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../..', import.meta.url).pathname;
const CONSOLES = ['features/console', 'features/admin', 'features/settings', 'features/server'];

/**
 * What may stay. Each entry is a file, the literal, and why it is not paint.
 *
 * The theme editor's fallback for `<input type="color">`: the platform's colour input
 * takes only `#rrggbb`, so a token it cannot read as hex is shown as black there. It is the
 * value of a form control, not a colour anything is drawn in.
 */
const ALLOWED: { file: string; literal: string }[] = [
  { file: 'features/admin/sections/ThemesSection.tsx', literal: '"#000000"' },
];

/** `//` to the end of the line — but not the `//` in `https://` — and every block comment. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w])\/\/.*$/gm, '');
}

const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|oklch|oklab)\(/g;
const PALETTE = new RegExp(
  String.raw`\b(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|shadow|accent|caret|divide|placeholder|inset-ring|inset-shadow)-` +
    String.raw`(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|black|white)` +
    String.raw`(?:-\d{2,3})?(?:\/\d+)?\b`,
  'g',
);

/**
 * Every literal colour in a piece of source, as written.
 *
 * A hex of letters alone — `#add`, `#bad`, `#face` — is also a word after a `#` in a
 * sentence, so one of those counts only where nothing else could be meant: as a whole
 * string, or as a Tailwind arbitrary value. A hex with a digit in it, or six or eight
 * long, counts wherever it is.
 */
function literalColours(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(HEX)) {
    const hex = match[0];
    const before = code[match.index - 1] ?? '';
    const after = code[match.index + hex.length] ?? '';
    const wordLike = !/\d/.test(hex) && hex.length <= 5;
    if (!wordLike || (/['"`[]/.test(before) && /['"`\]]/.test(after))) {
      found.push(`${before}${hex}${after}`);
    }
  }
  for (const pattern of [FUNCTION, PALETTE]) {
    for (const match of code.matchAll(pattern)) found.push(match[0]);
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('the consoles', () => {
  it('paints the console from theme variables only', () => {
    const files = CONSOLES.flatMap((dir) => walk(join(SRC, dir))).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    );
    // Guard the guard: an empty walk would pass.
    expect(files.length).toBeGreaterThan(50);

    const found = files.flatMap((file) => {
      const name = relative(SRC, file);
      const allowed = ALLOWED.filter((entry) => entry.file === name).map((entry) => entry.literal);
      return literalColours(withoutComments(readFileSync(file, 'utf8')))
        .filter((literal) => !allowed.some((entry) => literal.includes(entry)))
        .map((literal) => `${name}: ${literal}`);
    });
    expect(found).toEqual([]);
  });

  it('knows a colour from a channel name', () => {
    expect(literalColours(`const a = '#fff'; <path fill="#0a0a0a" />`)).toHaveLength(2);
    expect(literalColours('className="bg-[#abc] text-red-500 hover:bg-black/10"')).toHaveLength(3);
    expect(literalColours("style={{ color: 'rgb(0 0 0)', fill: 'oklch(0.5 0 0)' }}")).toHaveLength(2);
    expect(literalColours('`Type #add to bring someone in, or ask in #general.`')).toEqual([]);
    expect(literalColours('href="#top" title="&#8212;" bg-background text-muted-foreground')).toEqual([]);
    expect(withoutComments('a // #fff\nb /* rgb( */ "https://x.test/#ccc"')).not.toMatch(/#fff|rgb\(/);
  });
});
