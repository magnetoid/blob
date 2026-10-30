/**
 * shadcn preset b0's palette, Blob's dark mode, and the bridge that hands both to the CSS
 * written before either.
 *
 * Read as text, because none of it can be watched in a unit test any other way: happy-dom
 * resolves no `var()` and knows no `prefers-color-scheme`. The dark variant is the
 * exception — Tailwind's own compiler is asked what `dark:` turns into.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor, toHex, type Rgb } from '../lib/color.ts';
import { B0_HEX } from '../lib/theme.ts';

const STYLES = new URL('.', import.meta.url).pathname;

interface Rule {
  /** The selector or at-rule before the brace, whitespace collapsed, quotes single. */
  prelude: string;
  declarations: Map<string, string>;
  /** Anything else that ends in `;` inside the block — `@slot`, `@apply …`. */
  statements: string[];
  children: Rule[];
}

/** `front` at `amount` over `back` — `color-mix(in srgb, front <amount>, back)`. */
const mix = (front: Rgb, back: Rgb, amount: number): Rgb => ({
  red: front.red * amount + back.red * (1 - amount),
  green: front.green * amount + back.green * (1 - amount),
  blue: front.blue * amount + back.blue * (1 - amount),
  alpha: 1,
});

const normalise = (text: string) => text.replace(/"/g, "'").replace(/\s+/g, ' ').trim();

/** Just enough of a CSS parser for two hand-written files: blocks, and what is in them. */
function parse(css: string): Rule[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  function block(start: number): { rule: Omit<Rule, 'prelude'>; end: number } {
    const rule: Omit<Rule, 'prelude'> = { declarations: new Map(), statements: [], children: [] };
    let buffer = '';
    const flush = () => {
      const text = normalise(buffer);
      buffer = '';
      if (!text) return;
      const declaration = /^(--[\w-]+)\s*:\s*([\s\S]*)$/.exec(text);
      if (declaration) rule.declarations.set(declaration[1]!, declaration[2]!);
      else rule.statements.push(text);
    };
    let index = start;
    while (index < code.length) {
      const char = code[index]!;
      if (char === '{') {
        const prelude = normalise(buffer);
        buffer = '';
        const inner = block(index + 1);
        rule.children.push({ prelude, ...inner.rule });
        index = inner.end + 1;
      } else if (char === '}') {
        flush();
        return { rule, end: index };
      } else if (char === ';') {
        flush();
        index += 1;
      } else {
        buffer += char;
        index += 1;
      }
    }
    flush();
    return { rule, end: index };
  }
  return block(0).rule.children;
}

function find(rules: Rule[], prelude: string): Rule {
  const found = rules.filter((rule) => rule.prelude === normalise(prelude));
  expect(found, `exactly one \`${prelude}\` block`).toHaveLength(1);
  return found[0]!;
}

const LIGHT = ':root';
const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const DARK_UNCHOSEN = ":root:not([data-theme='light'])";
const DARK_CHOSEN = ":root[data-theme='dark']";

/** The three blocks a palette has: light, dark by the OS, and dark by the viewer's choice. */
function palettes(file: string) {
  const rules = parse(readFileSync(join(STYLES, file), 'utf8'));
  return {
    rules,
    light: find(rules, LIGHT),
    darkByOs: find(
      rules.filter((rule) => rule.prelude === DARK_MEDIA).flatMap((rule) => rule.children),
      DARK_UNCHOSEN,
    ),
    darkByChoice: find(rules, DARK_CHOSEN),
  };
}

/**
 * Preset b0 (Nova, Neutral) as ui.shadcn.com/create publishes it, light then dark. Two
 * departures, both for WCAG AA, and Blob does not ship a colour nobody can read: light
 * `--muted-foreground` (b0's `oklch(0.556 0 0)` is 4.35:1 on its own `--muted`) and light
 * `--destructive` (b0's `oklch(0.577 0.245 27.325)` is 4.13:1 on the 8% destructive tint
 * Blob's pills and badges are drawn on).
 */
const B0: Record<string, [light: string, dark: string | null]> = {
  '--background': ['oklch(1 0 0)', 'oklch(0.145 0 0)'],
  '--foreground': ['oklch(0.145 0 0)', 'oklch(0.985 0 0)'],
  '--card': ['oklch(1 0 0)', 'oklch(0.205 0 0)'],
  '--card-foreground': ['oklch(0.145 0 0)', 'oklch(0.985 0 0)'],
  '--popover': ['oklch(1 0 0)', 'oklch(0.205 0 0)'],
  '--popover-foreground': ['oklch(0.145 0 0)', 'oklch(0.985 0 0)'],
  '--primary': ['oklch(0.205 0 0)', 'oklch(0.922 0 0)'],
  '--primary-foreground': ['oklch(0.985 0 0)', 'oklch(0.205 0 0)'],
  '--secondary': ['oklch(0.97 0 0)', 'oklch(0.269 0 0)'],
  '--secondary-foreground': ['oklch(0.205 0 0)', 'oklch(0.985 0 0)'],
  '--muted': ['oklch(0.97 0 0)', 'oklch(0.269 0 0)'],
  '--muted-foreground': ['oklch(0.54 0 0)', 'oklch(0.708 0 0)'],
  '--accent': ['oklch(0.97 0 0)', 'oklch(0.269 0 0)'],
  '--accent-foreground': ['oklch(0.205 0 0)', 'oklch(0.985 0 0)'],
  '--destructive': ['oklch(0.54 0.22 27.3)', 'oklch(0.704 0.191 22.216)'],
  '--border': ['oklch(0.922 0 0)', 'oklch(1 0 0 / 10%)'],
  '--input': ['oklch(0.922 0 0)', 'oklch(1 0 0 / 15%)'],
  '--ring': ['oklch(0.708 0 0)', 'oklch(0.556 0 0)'],
  '--chart-1': ['oklch(0.87 0 0)', 'oklch(0.87 0 0)'],
  '--chart-2': ['oklch(0.556 0 0)', 'oklch(0.556 0 0)'],
  '--chart-3': ['oklch(0.439 0 0)', 'oklch(0.439 0 0)'],
  '--chart-4': ['oklch(0.371 0 0)', 'oklch(0.371 0 0)'],
  '--chart-5': ['oklch(0.269 0 0)', 'oklch(0.269 0 0)'],
  '--radius': ['0.625rem', null],
  '--sidebar': ['oklch(0.985 0 0)', 'oklch(0.205 0 0)'],
  '--sidebar-foreground': ['oklch(0.145 0 0)', 'oklch(0.985 0 0)'],
  '--sidebar-primary': ['oklch(0.205 0 0)', 'oklch(0.488 0.243 264.376)'],
  '--sidebar-primary-foreground': ['oklch(0.985 0 0)', 'oklch(0.985 0 0)'],
  '--sidebar-accent': ['oklch(0.97 0 0)', 'oklch(0.269 0 0)'],
  '--sidebar-accent-foreground': ['oklch(0.205 0 0)', 'oklch(0.985 0 0)'],
  '--sidebar-border': ['oklch(0.922 0 0)', 'oklch(1 0 0 / 10%)'],
  '--sidebar-ring': ['oklch(0.708 0 0)', 'oklch(0.556 0 0)'],
};

describe('styles/theme.css — preset b0', () => {
  it('defines every b0 variable for light and dark', () => {
    const { light, darkByOs, darkByChoice } = palettes('theme.css');
    for (const [name, [lightValue, darkValue]] of Object.entries(B0)) {
      expect(light.declarations.get(name), `light ${name}`).toBe(lightValue);
      if (darkValue === null) continue;
      expect(darkByOs.declarations.get(name), `dark (OS) ${name}`).toBe(darkValue);
      expect(darkByChoice.declarations.get(name), `dark (chosen) ${name}`).toBe(darkValue);
    }
    // Nothing else hides in the palettes: what b0 does not define, Blob does not either.
    expect([...light.declarations.keys()].sort()).toEqual(Object.keys(B0).sort());
  });

  it('applies dark both before and after JS', async () => {
    const { rules, darkByOs, darkByChoice } = palettes('theme.css');
    // Written twice and kept identical: the OS answer before `theme-boot.js` has run or
    // when the viewer chose "system", the viewer's own answer after.
    expect(Object.fromEntries(darkByOs.declarations)).toEqual(
      Object.fromEntries(darkByChoice.declarations),
    );
    // shadcn's `.dark` class is not how Blob says dark; nothing may still key on it.
    const code = readFileSync(join(STYLES, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\.dark\b/);

    // `dark:` must answer to the same two conditions as the palette.
    const variant = rules.find((rule) => rule.prelude === '@custom-variant dark');
    expect(variant, 'an @custom-variant dark block').toBeDefined();
    const compiler = await compile(`${normaliseVariant(variant!)}\n@tailwind utilities;`);
    const out = normalise(compiler.build(['dark:flex']));
    expect(out).toContain(
      `${DARK_MEDIA} { .dark\\:flex:where(${DARK_UNCHOSEN}, ${DARK_UNCHOSEN} *) { display: flex; } }`,
    );
    expect(out).toContain(
      ".dark\\:flex:where([data-theme='dark'], [data-theme='dark'] *) { display: flex; }",
    );
    // A light choice must win over a dark OS: the media rule is scoped away from it.
    expect(out).not.toMatch(/\.dark\\:flex\s*\{/);
  });

  it('keeps muted text readable, light and dark', () => {
    const { light, darkByOs } = palettes('theme.css');
    for (const [mode, palette] of [
      ['light', light],
      ['dark', darkByOs],
    ] as const) {
      const colour = (name: string) => {
        const parsed = parseColor(palette.declarations.get(name) ?? '');
        expect(parsed, `${mode} ${name} parses`).not.toBeNull();
        return parsed!;
      };
      for (const ground of ['--muted', '--sidebar', '--background', '--card', '--accent']) {
        const ratio = contrastRatio(colour('--muted-foreground'), colour(ground));
        expect(ratio, `${mode} --muted-foreground on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps destructive text readable on the page, a card, and its own 8% tint', () => {
    // `.role-pill`, `.task-badge`, `.feedback-kind` and `.janus-banner` draw the danger
    // colour on `color-mix(in srgb, var(--danger) 8%, …)` of themselves, over whatever the
    // card is. b0's light red is 4.13:1 on that; this holds the one Blob ships to AA.
    const { light, darkByOs } = palettes('theme.css');
    for (const [mode, palette] of [
      ['light', light],
      ['dark', darkByOs],
    ] as const) {
      const colour = (name: string) => {
        const parsed = parseColor(palette.declarations.get(name) ?? '');
        expect(parsed, `${mode} ${name} parses`).not.toBeNull();
        return parsed!;
      };
      const red = colour('--destructive');
      for (const ground of ['--background', '--card', '--muted', '--accent', '--sidebar']) {
        expect(
          contrastRatio(red, colour(ground)),
          `${mode} --destructive on ${ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const ground of ['--background', '--card']) {
        const tint = mix(red, colour(ground), 0.08);
        expect(
          contrastRatio(red, tint),
          `${mode} --destructive on an 8% tint of itself over ${ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives Tailwind a colour utility for each variable, and Inter as the sans', () => {
    const rules = parse(readFileSync(join(STYLES, 'theme.css'), 'utf8'));
    const theme = find(rules, '@theme inline');
    for (const name of Object.keys(B0)) {
      if (name === '--radius') continue;
      expect(theme.declarations.get(`--color-${name.slice(2)}`), name).toBe(`var(${name})`);
    }
    expect(theme.declarations.get('--font-sans')).toBe("'Inter Variable', system-ui, sans-serif");
    for (const step of ['sm', 'md', 'lg', 'xl']) {
      expect(theme.declarations.get(`--radius-${step}`), step).toMatch(/var\(--radius\)/);
    }
  });
});

describe('lib/theme.ts — b0 as hex', () => {
  it("is what theme.css says, for the colours a theme is drawn with when it sets none", () => {
    // The theme editor's swatches, the palette previews and the browser chrome cannot
    // wear a stylesheet, so they carry b0's values as hex. They must not drift from it.
    const { light, darkByOs } = palettes('theme.css');
    for (const [mode, palette] of [
      ['light', light],
      ['dark', darkByOs],
    ] as const) {
      for (const [name, hex] of Object.entries(B0_HEX[mode])) {
        expect(toHex(palette.declarations.get(name) ?? ''), `${mode} ${name}`).toBe(hex);
      }
    }
  });
});

describe('styles/tokens.css — Blob state colours that shadcn has no word for', () => {
  it('keeps unread text at 4.5:1 on the page, the sidebar and a card, light and dark', () => {
    const theme = palettes('theme.css');
    const tokens = palettes('tokens.css');
    for (const [mode, palette, text] of [
      ['light', theme.light, tokens.light.declarations.get('--unread-text')],
      ['dark', theme.darkByOs, tokens.light.declarations.get('--dark-unread-text')],
    ] as const) {
      const ink = parseColor(text ?? '');
      expect(ink, `${mode} unread text parses`).not.toBeNull();
      for (const ground of ['--background', '--sidebar', '--card']) {
        const colour = parseColor(palette.declarations.get(ground) ?? '');
        expect(colour, `${mode} ${ground} parses`).not.toBeNull();
        expect(
          contrastRatio(ink!, colour!),
          `${mode} --unread-text on ${ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('selects the dark unread text in both dark blocks', () => {
    const { darkByOs, darkByChoice } = palettes('tokens.css');
    for (const dark of [darkByOs, darkByChoice]) {
      expect(dark.declarations.get('--unread-text')).toBe('var(--dark-unread-text)');
    }
  });
});

/** `@custom-variant` back to text, for Tailwind's compiler. */
function normaliseVariant(rule: Rule): string {
  const body = (inner: Rule): string =>
    [
      ...inner.statements.map((statement) => `${statement};`),
      ...inner.children.map((child) => `${child.prelude} { ${body(child)} }`),
    ].join(' ');
  return `${rule.prelude} { ${body(rule)} }`;
}

/**
 * Every legacy colour reads shadcn's variable instead of holding a value, so a screen
 * nobody has converted yet already wears b0. The dark blocks lose these names: a bridge
 * is a `var()`, and follows shadcn's dark values on its own.
 */
const BRIDGE: Record<string, string> = {
  '--bg': 'var(--background)',
  '--bg-rail': 'var(--sidebar)',
  '--bg-sidebar': 'var(--sidebar)',
  '--surface': 'var(--card)',
  '--surface-hover': 'var(--accent)',
  '--surface-hover-warm': 'var(--accent)',
  '--surface-hover-deep': 'var(--accent)',
  '--surface-row-hover': 'var(--accent)',
  '--surface-muted': 'var(--muted)',
  '--surface-icon': 'var(--muted)',
  '--avatar-bg': 'var(--muted)',
  '--disabled-bg': 'var(--muted)',
  '--hairline': 'var(--border)',
  '--hairline-soft': 'var(--border)',
  '--hairline-popover': 'var(--border)',
  '--blob-accent-border-soft': 'var(--border)',
  '--scrollbar': 'var(--border)',
  '--hairline-strong': 'var(--ring)',
  '--blob-accent-border': 'var(--ring)',
  '--text': 'var(--foreground)',
  '--text-body': 'var(--foreground)',
  '--text-2': 'var(--foreground)',
  '--text-3': 'var(--muted-foreground)',
  '--text-4': 'var(--muted-foreground)',
  '--text-5': 'var(--muted-foreground)',
  '--text-label': 'var(--muted-foreground)',
  '--text-faint': 'var(--muted-foreground)',
  '--text-rail': 'var(--muted-foreground)',
  '--disabled-fg': 'var(--muted-foreground)',
  '--blob-accent': 'var(--primary)',
  '--blob-accent-hover': 'color-mix(in oklab, var(--primary) 90%, transparent)',
  '--blob-accent-contrast': 'var(--primary-foreground)',
  '--blob-accent-wash': 'var(--sidebar-accent)',
  '--blob-accent-wash-rail': 'var(--sidebar-accent)',
  '--blob-accent-wash-soft': 'var(--sidebar-accent)',
  '--danger': 'var(--destructive)',
  '--track-off': 'var(--input)',
  '--knob': 'var(--background)',
  '--font-ui': 'var(--font-sans)',
  '--blob-radius-xs': 'var(--radius-sm)',
  '--blob-radius-sm': 'var(--radius-sm)',
  '--blob-radius-md': 'var(--radius-md)',
  '--radius-input': 'var(--radius-lg)',
  '--blob-radius-lg': 'var(--radius-xl)',
};

describe('styles/tokens.css — the bridge', () => {
  it('points every legacy colour, the UI font and the radius steps at shadcn', () => {
    const { light } = palettes('tokens.css');
    for (const [name, value] of Object.entries(BRIDGE)) {
      expect(light.declarations.get(name), name).toBe(value);
    }
  });

  it('leaves bridged names out of the dark blocks and keeps the rest', () => {
    const { rules, darkByOs, darkByChoice } = palettes('tokens.css');
    for (const dark of [darkByOs, darkByChoice]) {
      const bridged = [...dark.declarations.keys()].filter((name) => name in BRIDGE);
      expect(bridged).toEqual([]);
      // What shadcn has no word for keeps a dark value of its own.
      for (const name of ['--presence-online', '--unread-line', '--iris', '--clay', '--backdrop']) {
        expect(dark.declarations.has(name), name).toBe(true);
      }
    }
    expect(Object.fromEntries(darkByOs.declarations)).toEqual(
      Object.fromEntries(darkByChoice.declarations),
    );
    // No rule anywhere in the file gives a bridged name a dark value by another route —
    // bar the one shadcn's own Switch needs (the next test).
    for (const rule of nested(rules)) {
      if (rule.prelude === LIGHT) continue;
      const bridged = [...rule.declarations.entries()].filter(([name]) => name in BRIDGE);
      if (rule.prelude.endsWith(` ${OFF_SWITCH}`)) {
        expect(OFF_SWITCH_RULES).toContain(rule.prelude);
        expect(bridged).toEqual([['--knob', 'var(--foreground)']]);
        continue;
      }
      expect(
        bridged.map(([name]) => name),
        rule.prelude,
      ).toEqual([]);
    }
  });

  it("keeps an off switch's knob findable in dark", () => {
    // b0's dark knob (--background) on b0's dark off track (--input, white at 15%, over
    // the card the switch sits on) is 1.7:1. WCAG asks 3:1 of a control's parts.
    const dark = palettes('theme.css').darkByOs.declarations;
    const colour = (value: string) => {
      const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      const parsed = parseColor(name ? (dark.get(name) ?? '') : value);
      expect(parsed, value).not.toBeNull();
      return parsed!;
    };
    const card = colour('var(--card)');
    const input = colour('var(--input)');
    const track: Rgb = {
      red: input.red * input.alpha + card.red * (1 - input.alpha),
      green: input.green * input.alpha + card.green * (1 - input.alpha),
      blue: input.blue * input.alpha + card.blue * (1 - input.alpha),
      alpha: 1,
    };

    const rules = nested(palettes('tokens.css').rules);
    for (const prelude of OFF_SWITCH_RULES) {
      const rule = rules.find((candidate) => candidate.prelude === prelude);
      expect(rule, prelude).toBeDefined();
      const knob = colour(rule!.declarations.get('--knob') ?? BRIDGE['--knob']!);
      expect(contrastRatio(knob, track), prelude).toBeGreaterThanOrEqual(3);
    }
  });
});

/** A `.toggle` that is off, and the two dark roots it is scoped under in tokens.css. */
const OFF_SWITCH = ".toggle:not([aria-pressed='true'])";
const OFF_SWITCH_RULES = [DARK_UNCHOSEN, DARK_CHOSEN].map((root) => `${root} ${OFF_SWITCH}`);

function nested(list: Rule[]): Rule[] {
  return list.flatMap((rule) => [rule, ...nested(rule.children)]);
}
