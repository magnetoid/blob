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

/** Like `occurrences`, but a test double naming a component is not a use of it — only
 *  production source counts. */
function productionOccurrences(needle: string, ext: string[]): number {
  return sources(SRC, ext)
    .filter((path) => !path.endsWith('sourceRatchets.test.ts') && !path.includes('.test.'))
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

describe('one RoomAudioRenderer', () => {
  /** `features/calls/CallAudio.tsx` is the only place LiveKit's own component may be
   *  used, mounted once for the page's life rather than once per Workspace branch
   *  (R31) — a second one would play a call twice. */
  it('is used in exactly one place', () => {
    expect(productionOccurrences('<RoomAudioRenderer', ['.tsx'])).toBe(1);
  });
});

/**
 * A specifier naming `livekit-client`, `@livekit/*`, or `features/calls/engine.ts` — the
 * one `features/calls/` may say freely, and everywhere else may reach only two ways:
 * `lib/calls.ts`'s dynamic `import()` (paid for once somebody actually starts or joins a
 * call) and its `typeof import(...)` type (names the engine's shape with no runtime
 * import at all). Both of those put the string right after `import(`; a plain
 * `import … from`, a bare `import '…'`, or `export … from` naming the same string does
 * not, and that is precisely a static import — the thing the W2 ratchet below exists to
 * catch before it puts LiveKit, most of a megabyte, back in everyone's main chunk.
 */
const LIVEKIT_SPECIFIER =
  /['"](livekit-client|@livekit\/[^'"]+|(?:[^'"]*\/)?features\/calls\/engine(?:\.ts)?)['"]/g;

/** Every match of `LIVEKIT_SPECIFIER` in `path` not immediately preceded by `import(` —
 *  the one piece of context shared by both allowed forms above. */
function forbiddenLiveKitSpecifiers(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const hits: string[] = [];
  for (const match of text.matchAll(LIVEKIT_SPECIFIER)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 20), index);
    if (/import\s*\(\s*$/.test(before)) continue; // a dynamic import(), or typeof import(...)
    hits.push(match[1]!);
  }
  return hits;
}

describe('LiveKit stays out of the main chunk (W2)', () => {
  /**
   * Named in two comments (`Workspace.tsx`, `lib/calls.ts`) and checked, until now, by a
   * `grep` somebody had to remember to run. `.test.` files are exempt: `vi.mock`ing
   * `'livekit-client'` names the same string with no bundle cost, since nothing under
   * `.test.` ships — `lib/calls.race.test.ts` does exactly that, outside
   * `features/calls/` itself.
   */
  it('is never statically imported outside features/calls/', () => {
    const offenders = sources(SRC, ['.ts', '.tsx'])
      .filter((path) => !path.includes('.test.'))
      .filter((path) => !path.includes('/features/calls/'))
      .flatMap((path) =>
        forbiddenLiveKitSpecifiers(path).map((specifier) => `${path}: ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });
});
