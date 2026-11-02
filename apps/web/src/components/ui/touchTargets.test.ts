/**
 * Anything sized for a pointer gets 44px under a finger.
 *
 * shadcn draws its controls for a mouse — a 32px button, an 18px switch — and Blob's rule
 * is that a coarse pointer gets a 44px target wherever it can press. Phase 2 wrote that at
 * each call site (`pointer-coarse:min-h-11` in the confirm dialog and the toasts); from the
 * consoles on, which use every control in the kit, it is baked into the components, so a
 * call site cannot forget it. A switch or a checkbox keeps the size it is drawn at and
 * takes the 44px on an invisible hit area round it — its `::after` — since a 44px switch
 * would be a different control.
 *
 * Read as text, like the stylesheet tests: what is asserted is the class the component
 * carries, because happy-dom has no media queries for `pointer` to measure against.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = new URL('.', import.meta.url).pathname;
const source = (file: string) => readFileSync(join(UI, file), 'utf8');

/** The class strings in a cva's `size` variants, by name. */
function sizes(code: string): Map<string, string> {
  const block = code.match(/size:\s*\{([\s\S]*?)\n\s{6}\}/)?.[1] ?? '';
  return new Map(
    [...block.matchAll(/"?([\w-]+)"?:\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!] as const),
  );
}

const FLOOR = 'pointer-coarse:min-h-11';
const WIDE = 'pointer-coarse:min-w-11';

describe('touch targets', () => {
  it('gives every control a 44px floor under a coarse pointer', () => {
    for (const file of ['button.tsx', 'input.tsx', 'native-select.tsx', 'tabs.tsx', 'toggle.tsx']) {
      expect(source(file), file).toContain(FLOOR);
    }

    // A button that is only an icon is as wide as it is tall, so it gets the width too.
    const button = sizes(source('button.tsx'));
    const icons = [...button.keys()].filter((name) => name.startsWith('icon'));
    expect(icons).toEqual(['icon', 'icon-xs', 'icon-sm', 'icon-lg']);
    for (const name of icons) expect(button.get(name), name).toContain(WIDE);
    // A toggle may be an icon alone at any size.
    expect(source('toggle.tsx')).toContain(WIDE);

    // The nav's rows: the menu button's own variants, not the trigger beside them.
    const menuButton = source('sidebar.tsx').match(
      /const sidebarMenuButtonVariants = cva\(\s*"([^"]*)"/,
    )?.[1];
    expect(menuButton).toContain(FLOOR);

    // A switch and a checkbox: the hit area, centred on the control, and not the control.
    for (const file of ['switch.tsx', 'checkbox.tsx']) {
      const code = source(file);
      expect(code, file).toContain('pointer-coarse:after:min-h-11');
      expect(code, file).toContain('pointer-coarse:after:top-1/2');
      expect(code, file).toContain('pointer-coarse:after:-translate-y-1/2');
      expect(code, file).not.toContain(FLOOR);
    }
    // A checkbox is 16px across, where a switch's hit area is already 56.
    expect(source('checkbox.tsx')).toContain('pointer-coarse:after:min-w-11');

    // A field with its button inside it — the copy field — grows round the controls it
    // holds, so neither spills over its edge.
    expect(source('input-group.tsx')).toMatch(/pointer-coarse:min-h-\[calc\(--spacing\(11\)\+2px\)\]/);
  });
});
