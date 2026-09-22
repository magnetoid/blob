/**
 * Counters on the client source that may go down and may not go up.
 *
 * The same idea `apps/api/tests/test_layering.py` used for SQL in routers, and for the
 * same reason: duplication does not arrive in one commit, it accumulates one reasonable
 * exception at a time. A number in a test is what makes the next one deliberate.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('..', import.meta.url).pathname;

function sources(dir: string, ext: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path, ext));
    else if (ext.some((e) => entry.endsWith(e))) out.push(path);
  }
  return out;
}

function occurrences(needle: string, ext: string[]): number {
  // This file names every pattern it counts, so it cannot count itself.
  return sources(SRC, ext)
    .filter((path) => !path.endsWith('sourceRatchets.test.ts'))
    .reduce(
      (total, path) => total + readFileSync(path, 'utf8').split(needle).length - 1,
      0,
    );
}

describe('inline styles keep leaving the components', () => {
  /**
   * 241 on 2026-09-12; 174 once the repeated layout properties became the six
   * utilities in app.css (`.grow`, `.min-0`, `.block`, `.relative`, `.m-0`,
   * `.ellipsis`). 47 on 2026-09-22, when the consoles got a space scale (`--space-*`)
   * and cards to spend it in, and their one-off margins and max-widths went with it.
   * Most of what is left is a value that is data — a palette's own colours, a bar's
   * height — or sits outside the consoles. Lower this, never raise it.
   */
  it('is at most the last committed count', () => {
    expect(occurrences('style={{', ['.tsx'])).toBeLessThanOrEqual(47);
  });
});

describe('fetch guards live in the hook', () => {
  /**
   * 17 hand-rolled `let cancelled = false` copies on 2026-09-12, beside a `useFetch`
   * that already did it. Two are left, and both are outside a component: the
   * bootstrap and the permalink jump. Everything with a render to guard uses the hook.
   */
  it('is at most the last committed count', () => {
    expect(occurrences('let cancelled = false', ['.ts', '.tsx'])).toBeLessThanOrEqual(2);
  });
});

describe('one dialog scaffold', () => {
  /** `components/Dialog.tsx` is the only focus trap; the other ten copies went in W3. */
  it('has no hand-rolled focus traps left', () => {
    expect(occurrences('trapFocus(', ['.ts', '.tsx'])).toBe(0);
  });
});
