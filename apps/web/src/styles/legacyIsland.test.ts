/**
 * Legacy markup inside a shadcn component, and motion for those who asked for less.
 *
 * `styles/app/base.css` opens by handing back the browser defaults Tailwind's preflight took
 * away — but only to markup outside any `[data-slot]`, because a shadcn component was
 * written against preflight. A dialog's body is the exception that phase 2 creates: the
 * shell is shadcn's and the body inside it is still the feature's own legacy markup, so
 * `Dialog` marks it `data-legacy`, and the repair has to reach in there — and stop again
 * at any shadcn component nested inside it. Without that, a form in a dialog loses its
 * button chrome, its icons go `display: block` and its headings lose their margins, and
 * nothing fails.
 *
 * The CSS is read as text: happy-dom's selector engine gets `:not()` with descendant
 * combinators wrong, so `matches()` here would test happy-dom rather than the rule. Where
 * the two clauses reach is asked of a reader of their own small grammar instead, below.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = new URL('.', import.meta.url).pathname;

/** A stylesheet with its comments gone: the prose names the selectors it explains. */
function css(file: string): string {
  return readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every rule's selector, at any depth, as written. */
function selectors(code: string): string[] {
  return [...code.matchAll(/([^{};]+)\{[^{}]*\}/g)].map((match) => match[1]!.trim());
}

/** The bodies of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlocks(code: string): string[] {
  const blocks: string[] = [];
  const opener = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  for (const match of code.matchAll(opener)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (depth > 0 && at < code.length) {
      if (code[at] === '{') depth += 1;
      if (code[at] === '}') depth -= 1;
      at += 1;
    }
    blocks.push(code.slice(start, at - 1));
  }
  return blocks;
}

/** Outside every shadcn component: the CSS that predates Tailwind. */
const OUTSIDE = ':not([data-slot], [data-slot] *)';
/** Inside an island, and not inside a shadcn component nested within it. */
const ISLAND = '[data-legacy] :not([data-slot], [data-legacy] [data-slot] *)';

describe('the preflight repair', () => {
  const repair = () => selectors(css('app/base.css')).filter((selector) => selector.includes('[data-slot]'));

  it('reaches legacy markup inside a shadcn component when it is marked as an island', () => {
    const rules = repair();
    // Guard the guard: the block is some thirty rules, and an empty match proves nothing.
    expect(rules.length).toBeGreaterThan(20);
    const repaired = `:where(${OUTSIDE}, ${ISLAND})`;
    for (const selector of rules) {
      // The two clauses as one alternative, which is what the reader below is asked about.
      expect(selector, selector).toContain(repaired);
      // Wherever the outside clause is used: a rule that keeps the old condition in one
      // compound and the new one in another is half-converted.
      expect(selector.split(repaired).length, selector).toBe(selector.split(OUTSIDE).length);
    }
  });

  it('stops again at a shadcn component nested inside an island', () => {
    // The island clause's own `:not()` names both the component and everything in it, so a
    // shadcn Button inside a legacy form keeps preflight's reset, which it was written for.
    expect(ISLAND).toMatch(/:not\(\[data-slot\], \[data-legacy\] \[data-slot\] \*\)$/);
    for (const selector of repair()) {
      // Never "anything inside an island", unguarded.
      expect(selector, selector).not.toMatch(/\[data-legacy\] \*/);
    }
  });

  it('is written zero-specificity, so every legacy rule still outranks it', () => {
    for (const selector of repair()) {
      for (const part of selector.split(',')) {
        if (!part.includes('[data-slot]')) continue;
        // Each condition sits inside a :where(), never bare.
        expect(selector, selector).toMatch(/:where\(/);
      }
    }
  });
});

/** Top-level parts of a selector, split on `separator` outside any parentheses. */
function parts(selector: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < selector.length; at += 1) {
    const char = selector[at];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === separator && depth === 0) {
      out.push(selector.slice(start, at));
      start = at + 1;
    }
  }
  out.push(selector.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

/** An element as the attributes it carries; a path runs from the root down to one. */
type Path = readonly (readonly string[])[];

/**
 * Whether the element at `at` matches a selector list — in exactly the grammar the two
 * clauses are written in: attribute tests, `*`, `:not()` of a list, and the descendant
 * combinator. Anything else throws, so the reader cannot quietly answer for a selector it
 * does not understand.
 */
function matches(list: string, path: Path, at = path.length - 1): boolean {
  return parts(list, ',').some((complex) => {
    const compounds = parts(complex, ' ');
    if (!compound(compounds.at(-1)!, path, at)) return false;
    // Right to left, each compound on the nearest ancestor that takes it. With nothing but
    // descendant combinators the nearest is never a worse choice than one further up.
    let index = at;
    for (const part of compounds.slice(0, -1).reverse()) {
      do {
        index -= 1;
      } while (index >= 0 && !compound(part, path, index));
      if (index < 0) return false;
    }
    return true;
  });
}

function compound(part: string, path: Path, at: number): boolean {
  if (part === '*') return true;
  const not = /^:not\((.*)\)$/.exec(part);
  if (not) return !matches(not[1]!, path, at);
  const attribute = /^\[([\w-]+)\]$/.exec(part);
  if (attribute) return path[at]!.includes(attribute[1]!);
  throw new Error(`Not a selector this reader knows: ${part}`);
}

describe('where the repair reaches', () => {
  /** A shadcn part, an island, and anything else. */
  const SLOT = ['data-slot'];
  const ISLE = ['data-legacy'];
  const NONE: string[] = [];
  /** Whether base.css hands the browser's defaults back to the last element of the path. */
  const reached = (...path: Path) => matches(`${OUTSIDE}, ${ISLAND}`, path);

  it('reads the clauses as the selector spec defines them', () => {
    // Guard the reader on the plain cases first.
    expect(reached(NONE, NONE)).toBe(true);
    expect(reached(NONE, SLOT)).toBe(false);
    expect(reached(SLOT, NONE)).toBe(false);
    expect(reached(SLOT, ISLE, NONE)).toBe(true);
  });

  it('reaches an island inside a card in the console, and stops at a shadcn part inside it', () => {
    // The sidebar's wrapper and inset, the page's column, the console body, a card and its
    // content: where the island holding an agent's memory, its notes, its terminal or a
    // run's card sits.
    const card = [SLOT, SLOT, NONE, SLOT, SLOT, SLOT];
    expect(reached(...card, ISLE, NONE)).toBe(true);
    expect(reached(...card, ISLE, NONE, NONE)).toBe(true);
    // A Button inside the legacy markup keeps preflight's reset, and so does its icon.
    expect(reached(...card, ISLE, NONE, SLOT)).toBe(false);
    expect(reached(...card, ISLE, NONE, SLOT, NONE)).toBe(false);
    // Converted markup in the body itself, outside any island, is preflight's.
    expect(reached(SLOT, SLOT, NONE, SLOT, NONE)).toBe(false);
  });

  it('does not reach an island inside a component inside another island', () => {
    // A selector cannot ask which island is nearest. This is why the console body is not
    // an island: while it was one, the islands its sections keep inside cards went
    // unreached.
    expect(reached(SLOT, ISLE, SLOT, ISLE, NONE)).toBe(false);
  });
});

/**
 * Reduce, not remove: a dialog, menu or popover still fades for somebody who asked for less
 * motion, and does not move.
 */
describe('reduced motion for overlays', () => {
  it('zeroes the transforms shadcn animates on an overlay’s first and last frames', () => {
    // shadcn's generated overlays move with tw-animate-css's `zoom-in-95` and
    // `slide-in-from-*`, keyframes that read these variables on any popup Base UI marks
    // as arriving or leaving. Zeroing them leaves the fade and stills the movement.
    const blocks = reducedMotionBlocks(css('app/base.css'));
    const rule = blocks
      .flatMap((block) => [...block.matchAll(/([^{};]+)\{([^{}]*)\}/g)])
      .find((match) => match[1]!.includes('[data-starting-style]') && match[1]!.includes('[data-ending-style]'));
    expect(rule, 'a reduced-motion rule for [data-starting-style] and [data-ending-style]').toBeTruthy();

    const declarations = rule![2]!.replace(/\s+/g, ' ');
    for (const name of [
      '--tw-enter-scale: 1',
      '--tw-exit-scale: 1',
      '--tw-enter-translate-x: 0',
      '--tw-enter-translate-y: 0',
      '--tw-exit-translate-x: 0',
      '--tw-exit-translate-y: 0',
      '--tw-enter-rotate: 0',
      '--tw-exit-rotate: 0',
    ]) {
      // `!important`, because the utilities that set them sit in a later layer.
      expect(declarations).toContain(`${name} !important`);
    }
    // The fade is left alone.
    expect(declarations).not.toContain('opacity');
  });

  it('moves Blob’s own dialog only by the tokens reduced motion zeroes', () => {
    // The dialog shell plays the legacy `overlay-in` and `overlay-out`, which travel by
    // --motion-slide and scale by --motion-scale-in — the two the token policy sets to
    // nothing under reduced motion.
    const motion = css('app/overlay-motion.css');
    for (const name of ['overlay-in', 'overlay-out']) {
      const keyframes = motion.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\}\\s*\\}`))?.[0] ?? '';
      expect(keyframes, name).toContain('var(--motion-slide)');
      expect(keyframes, name).toContain('var(--motion-scale-in)');
    }
    const policy = reducedMotionBlocks(css('app/base.css')).join('\n');
    expect(policy).toMatch(/--motion-slide:\s*0px/);
    expect(policy).toMatch(/--motion-scale-in:\s*1/);

    const shell = readFileSync(join(STYLES, '../components/overlays/DialogImpl.tsx'), 'utf8');
    expect(shell).toMatch(/animate-\[overlay-in_/);
    expect(shell).toMatch(/animate-\[overlay-out_/);
  });

  it('moves the menus and popovers drawn in place by the same keyframes, and nothing of shadcn’s', () => {
    // The menu panel and the popover — the person card, the emoji picker — arrive and leave
    // on `overlay-in`/`overlay-out` too (`components/overlays/inPlace.ts`, which both use),
    // so under reduced motion they fade and do not move. Not shadcn's `slide-in-from-*` and
    // `zoom-in-95`, which the rule above stills only through the variables.
    const motion = readFileSync(join(STYLES, '../components/overlays/inPlace.ts'), 'utf8');
    expect(motion).toMatch(/animate-\[overlay-in_/);
    expect(motion).toMatch(/data-ending-style:animate-\[overlay-out_/);
    for (const impl of ['MenuImpl.tsx', 'PopoverImpl.tsx']) {
      const source = readFileSync(join(STYLES, '../components/overlays', impl), 'utf8');
      expect(source, impl).toMatch(/from '\.\/inPlace\.ts'/);
      expect(source, impl).not.toMatch(/slide-in-from|zoom-in-/);
    }
    // The picker's old entrance in the legacy sheet is gone: the popover plays it now, and
    // two would play at once.
    expect(selectors(css('app/overlay-motion.css')).join('\n')).not.toMatch(/\.emoji-picker\b/);
  });
});
