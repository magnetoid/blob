/**
 * The avatar, the empty state and the skeleton write every length in px, as the
 * stylesheets they replaced did.
 *
 * Tailwind's scale is rem (`size-5` is 1.25rem), and a component that mixes the two comes
 * apart at any default font size but 16px: an avatar's `md` at 30px would stay put while
 * `sm` and `lg` grew around it, and a skeleton's avatar would stop matching the real one.
 * The generated parts under `ui/` are shadcn's and keep shadcn's units; this is about the
 * classes these components lay over them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['Avatar.tsx', 'EmptyState.tsx', 'ListSkeleton.tsx'];

/**
 * A sizing or spacing utility on Tailwind's scale, under any variant: `size-5`,
 * `data-[size=sm]:size-5`, `[.console-card>&]:mt-4`, `gap-2.5`. Not zero, which has no
 * unit, and not an arbitrary value (`size-[20px]`), which says its own.
 */
const SCALE =
  /(?<![\w-])(?:size|w|h|min-w|min-h|max-w|max-h|p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|inset|top|right|bottom|left)-(?!0(?![.\d]))\d+(?:\.\d+)?(?![\w.])/g;

/** The code, without its prose: a comment may name a utility it is explaining. */
function code(file: string): string {
  return readFileSync(`${import.meta.dirname}/${file}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('lengths in the converted primitives', () => {
  it('are px, as the stylesheets they replaced were', () => {
    const onTheScale = Object.fromEntries(FILES.map((file) => [file, code(file).match(SCALE) ?? []]));
    expect(onTheScale).toEqual(Object.fromEntries(FILES.map((file) => [file, []])));
  });

  it('would catch one on the scale', () => {
    // The pattern is the test; a pattern that matched nothing would pass anything.
    const sample = 'a data-[size=sm]:size-5 [.x>&]:mt-4 gap-2.5 size-[20px] py-0 p-0.5 max-w-[60%]';
    expect(sample.match(SCALE)).toEqual(['size-5', 'mt-4', 'gap-2.5', 'p-0.5']);
  });
});
