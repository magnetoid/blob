// @vitest-environment happy-dom
/**
 * The app's thirty-nine icons are Lucide's, drawn at Blob's four sizes with Blob's strokes.
 *
 * What a caller relies on is the name, the `size` role and the weight that goes with it,
 * and that an icon is decoration unless it says otherwise — not which paths are inside. So
 * these read the rendered `<svg>`, and the source only to hold the line that nothing is
 * hand-traced any more.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentType, SVGProps } from 'react';
import * as Icons from './Icon.tsx';

afterEach(cleanup);

type Size = 'sm' | 'md' | 'lg' | 'xl';
type AnyIcon = ComponentType<Omit<SVGProps<SVGSVGElement>, 'size'> & { size?: Size }>;

const PX: Record<Size, number> = { sm: 14, md: 16, lg: 18, xl: 20 };
const STROKE: Record<Size, number> = { sm: 1.9, md: 1.8, lg: 1.7, xl: 1.7 };

const icons = Object.entries(Icons) as [string, AnyIcon][];

function draw(Icon: AnyIcon, props: Omit<SVGProps<SVGSVGElement>, 'size'> & { size?: Size } = {}) {
  const { container } = render(<Icon {...props} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg');
  return svg;
}

describe('the icon set', () => {
  // Thirty-nine since the consoles' menu button became the Sidebar's own trigger and
  // MenuIcon lost its last caller.
  it('is the thirty-nine names the app already imports', () => {
    expect(icons).toHaveLength(39);
    expect(icons.every(([name]) => name.endsWith('Icon'))).toBe(true);
  });

  it("every export renders a Lucide svg at its role's size", () => {
    for (const [name, Icon] of icons) {
      for (const size of Object.keys(PX) as Size[]) {
        const svg = draw(Icon, { size });
        expect(svg.classList.contains('lucide'), name).toBe(true);
        expect(svg.getAttribute('width'), `${name} ${size}`).toBe(String(PX[size]));
        expect(svg.getAttribute('height'), `${name} ${size}`).toBe(String(PX[size]));
        cleanup();
      }
      // No size is the default role, a button's.
      expect(draw(Icon).getAttribute('width'), name).toBe('16');
      cleanup();
    }
  });

  it('draws each name as a different glyph', () => {
    // A copy-paste slip — two exports wrapping the same Lucide icon — would pass every
    // other test here. `lucide-<name>` is the icon's own class.
    const glyphs = icons.map(([, Icon]) => {
      const svg = draw(Icon);
      const glyph = [...svg.classList].find((name) => name.startsWith('lucide-'));
      cleanup();
      return glyph;
    });
    expect(glyphs.every(Boolean)).toBe(true);
    expect(new Set(glyphs).size).toBe(39);
  });

  it('carries the weight with the size, and the few optical corrections on top', () => {
    for (const size of Object.keys(PX) as Size[]) {
      expect(draw(Icons.HomeIcon, { size }).getAttribute('stroke-width')).toBe(String(STROKE[size]));
      cleanup();
    }
    // A bare + or × is two strokes and a lot of empty box; these carry a little more, as
    // they did, and still get lighter as they get larger.
    expect(draw(Icons.CloseIcon).getAttribute('stroke-width')).toBe('2.2');
    cleanup();
    expect(draw(Icons.PlusIcon).getAttribute('stroke-width')).toBe('2');
    cleanup();
    expect(draw(Icons.CheckIcon, { size: 'xl' }).getAttribute('stroke-width')).toBe('1.9');
    cleanup();
    expect(draw(Icons.SendIcon).getAttribute('stroke-width')).toBe('1.9');
  });

  it('fills the controls that are solid shapes in every player', () => {
    for (const Icon of [Icons.PlayIcon, Icons.PauseIcon]) {
      expect(draw(Icon).getAttribute('fill')).toBe('currentColor');
      cleanup();
    }
    expect(draw(Icons.HomeIcon).getAttribute('fill')).toBe('none');
  });

  it("draws More's dots as Lucide does, from the stroke alone", () => {
    // Lucide's dots are r 1, and the stroke already closes them. A fill on top added
    // nothing to their size and was one more thing to keep in step with Lucide.
    expect(draw(Icons.MoreIcon).getAttribute('fill')).toBe('none');
  });

  it('is decoration unless the caller says otherwise', () => {
    expect(draw(Icons.SearchIcon).getAttribute('aria-hidden')).toBe('true');
    cleanup();
    // Whatever the caller passes lands on the svg after the default, as it always did.
    const named = draw(Icons.SearchIcon, { 'aria-hidden': false, 'aria-label': 'Search' });
    expect(named.getAttribute('aria-hidden')).toBe('false');
    expect(named.getAttribute('aria-label')).toBe('Search');
    cleanup();
    const classed = draw(Icons.SearchIcon, { className: 'search-mark' });
    expect(classed.classList.contains('search-mark')).toBe(true);
    expect(classed.getAttribute('stroke')).toBe('currentColor');
  });

  it('sits inline in legacy markup, as the hand-drawn ones did', () => {
    // The preflight repair (styles/app/base.css) hands `display` back to an svg outside
    // every `[data-slot]`. Lucide stamps none, so an icon beside a label in a legacy row
    // stays on the line with it rather than taking preflight's `display: block`.
    const { container } = render(
      <button type="button">
        <Icons.ReplyIcon /> Reply
      </button>,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.hasAttribute('data-slot')).toBe(false);
    expect(svg.closest('[data-slot]')).toBeNull();
  });

  it('carries no hand-drawn paths', () => {
    const source = readFileSync(`${import.meta.dirname}/Icon.tsx`, 'utf8');
    expect(source).not.toMatch(/<path\b/);
    expect(source).not.toMatch(/<(circle|rect|line|polyline|polygon)\b/);
    expect(source).not.toMatch(/\bd="/);
    expect(source).toMatch(/from ['"]lucide-react['"]/);
  });
});
