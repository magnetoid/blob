import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor, toHex } from './color.ts';

/** `#rrggbb` → its three channels, for a within-one comparison. */
function channels(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

describe('toHex', () => {
  it('converts oklch() through OKLab to sRGB', () => {
    expect(toHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(toHex('oklch(0.145 0 0)')).toBe('#0a0a0a');
    expect(toHex('oklch(0 0 0)')).toBe('#000000');
  });

  it('lands a chromatic oklch() within one step per channel of the sRGB it names', () => {
    // b0's light --destructive, which Tailwind's palette publishes as #e7000b.
    const hex = toHex('oklch(0.577 0.245 27.325)');
    expect(hex).toMatch(/^#[\da-f]{6}$/);
    const got = channels(hex!);
    const want = channels('#e7000b');
    got.forEach((value, index) => {
      expect(Math.abs(value - want[index]!)).toBeLessThanOrEqual(1);
    });
  });

  it('passes hex and rgb() through as #rrggbb', () => {
    expect(toHex('#1F5C3D')).toBe('#1f5c3d');
    expect(toHex('#fff')).toBe('#ffffff');
    expect(toHex('rgb(26 29 27)')).toBe('#1a1d1b');
  });

  it('answers null for what it cannot read', () => {
    expect(toHex('oklch(var(--x))')).toBeNull();
    expect(toHex('color-mix(in oklab, red 50%, blue)')).toBeNull();
    expect(toHex('')).toBeNull();
  });
});

describe('parseColor', () => {
  it('reads an oklch() alpha as a fraction, in either notation', () => {
    expect(parseColor('oklch(1 0 0 / 10%)')!.alpha).toBe(0.1);
    expect(parseColor('oklch(1 0 0 / 0.15)')!.alpha).toBe(0.15);
    expect(parseColor('oklch(0.708 0 0)')!.alpha).toBe(1);
  });

  it('reads a lightness given as a percentage and a hue given in degrees', () => {
    expect(toHex('oklch(14.5% 0 0)')).toBe('#0a0a0a');
    expect(toHex('oklch(0.577 0.245 27.325deg)')).toBe(toHex('oklch(0.577 0.245 27.325)'));
  });

  it('still reads hex and rgb(), as themeContrast always has', () => {
    expect(parseColor('#1f5c3d')).toEqual({ red: 31, green: 92, blue: 61, alpha: 1 });
    expect(parseColor('rgb(26 29 27 / 32%)')).toEqual({
      red: 26,
      green: 29,
      blue: 27,
      alpha: 0.32,
    });
    expect(parseColor('rgba(0, 0, 0, 0.5)')!.alpha).toBe(0.5);
  });

  it('refuses a value that is not a literal colour', () => {
    expect(parseColor('oklch(var(--x))')).toBeNull();
    expect(parseColor('oklch(0.5 0.1)')).toBeNull();
    expect(parseColor('oklch(0.5 0.1 nonsense)')).toBeNull();
    // A hue is a bare number or degrees; a percentage is invalid CSS, and the server's
    // grammar refuses it too, so the editor must not preview what cannot be saved.
    expect(parseColor('oklch(0.5 0.1 27%)')).toBeNull();
    expect(toHex('oklch(0.5 0.1 27%)')).toBeNull();
    expect(parseColor('oklch(0.5 0.1 27%deg)')).toBeNull();
    expect(parseColor('oklch(0.5 0.1 27deg)')).not.toBeNull();
    expect(parseColor('var(--background)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is the WCAG relative-luminance ratio, either way round', () => {
    const black = parseColor('#000000')!;
    const white = parseColor('#ffffff')!;
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, black)).toBe(21);
    expect(contrastRatio(white, white)).toBe(1);
  });

  it('lays a translucent foreground over its background before measuring', () => {
    expect(contrastRatio(parseColor('rgb(0 0 0 / 50%)')!, parseColor('#ffffff')!)).toBeCloseTo(
      3.98,
      1,
    );
  });
});
