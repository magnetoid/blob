/**
 * Colours as numbers: enough of CSS Color 4 to read the values Blob's palettes are
 * written in — hex, `rgb()`/`rgba()` and `oklch()` — and to measure WCAG contrast
 * between two of them.
 *
 * shadcn's variables are `oklch()`, and a theme editor, a contrast check or a
 * `<input type="color">` all need sRGB; nothing here resolves `var()`, `calc()` or
 * `color-mix()`, and a value that uses one is "not a colour" (`null`) rather than a
 * guess.
 */

export interface Rgb {
  /** 0–255, unrounded: an `oklch()` rarely lands on a whole step. */
  red: number;
  green: number;
  blue: number;
  /** 0–1. */
  alpha: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** `50%` → 0.5 × `scale`; a bare number as it is. NaN for anything else. */
function number(part: string, scale: number): number {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(part)) return Number.NaN;
  return part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * scale : Number(part);
}

function fromHex(text: string): Rgb | null {
  const short = /^#([\da-f])([\da-f])([\da-f])([\da-f])?$/i.exec(text);
  if (short) {
    return {
      red: Number.parseInt(`${short[1]}${short[1]}`, 16),
      green: Number.parseInt(`${short[2]}${short[2]}`, 16),
      blue: Number.parseInt(`${short[3]}${short[3]}`, 16),
      alpha: short[4] ? Number.parseInt(`${short[4]}${short[4]}`, 16) / 255 : 1,
    };
  }
  const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i.exec(text);
  if (long) {
    return {
      red: Number.parseInt(long[1] ?? '0', 16),
      green: Number.parseInt(long[2] ?? '0', 16),
      blue: Number.parseInt(long[3] ?? '0', 16),
      alpha: long[4] ? Number.parseInt(long[4], 16) / 255 : 1,
    };
  }
  return null;
}

/** `rgb()` and `rgba()`, comma or space separated, as `themeContrast` always read them. */
function fromRgb(text: string): Rgb | null {
  const rgb = /^rgba?\((.+)\)$/.exec(text);
  if (!rgb?.[1]) return null;
  const parts = rgb[1].replace(/[,/]/g, ' ').trim().split(/\s+/);
  if (parts.length < 3) return null;
  const channel = (part: string) => clamp(number(part, 255), 0, 255);
  const alpha = parts[3] === undefined ? 1 : number(parts[3], 1);
  if (![...parts.slice(0, 3).map(channel), alpha].every(Number.isFinite)) return null;
  return {
    red: channel(parts[0] ?? '0'),
    green: channel(parts[1] ?? '0'),
    blue: channel(parts[2] ?? '0'),
    alpha: clamp(alpha, 0, 1),
  };
}

/**
 * `oklch(L C H)` or `oklch(L C H / A)`, through OKLab and linear sRGB to sRGB, with
 * Björn Ottosson's matrices (bottosson.github.io/posts/oklab). Out-of-gamut channels are
 * clipped, which is what a browser draws for a vivid red like b0's `--destructive` give
 * or take one step.
 */
function fromOklch(text: string): Rgb | null {
  const oklch = /^oklch\(\s*([^/)]+?)\s*(?:\/\s*([^)]+?)\s*)?\)$/i.exec(text);
  if (!oklch?.[1]) return null;
  const parts = oklch[1].split(/\s+/);
  if (parts.length !== 3) return null;
  const lightness = number(parts[0]!, 1);
  const chroma = number(parts[1]!, 0.4);
  const hue = number(parts[2]!.replace(/deg$/i, ''), 1);
  const alpha = oklch[2] === undefined ? 1 : number(oklch[2], 1);
  if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return null;

  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [red, green, blue] = linear.map((value) => {
    const v = clamp(value, 0, 1);
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return clamp(encoded, 0, 1) * 255;
  });
  return { red: red!, green: green!, blue: blue!, alpha: clamp(alpha, 0, 1) };
}

/** A literal colour, or `null` for anything that is not one. */
export function parseColor(value: string): Rgb | null {
  const text = value.trim();
  if (text.startsWith('#')) return fromHex(text);
  if (/^rgba?\(/.test(text)) return fromRgb(text);
  if (/^oklch\(/i.test(text)) return fromOklch(text);
  return null;
}

/** `#rrggbb`, alpha dropped — what `<input type="color">` takes. */
export function toHex(value: string): string | null {
  const color = parseColor(value);
  if (!color) return null;
  const hex = (channel: number) => Math.round(channel).toString(16).padStart(2, '0');
  return `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`;
}

/** `front` laid over `back` — source-over. */
function composite(front: Rgb, back: Rgb): Rgb {
  const alpha = front.alpha + back.alpha * (1 - front.alpha);
  const channel = (top: number, bottom: number) =>
    alpha === 0 ? 0 : (top * front.alpha + bottom * back.alpha * (1 - front.alpha)) / alpha;
  return {
    red: channel(front.red, back.red),
    green: channel(front.green, back.green),
    blue: channel(front.blue, back.blue),
    alpha,
  };
}

/** WCAG 2's relative luminance. */
function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

/**
 * WCAG 2's contrast ratio of `foreground` drawn on `background`. A translucent
 * background is laid on white first and a translucent foreground on the result, since
 * that is what reaches the screen.
 */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const canvas: Rgb = { red: 255, green: 255, blue: 255, alpha: 1 };
  const ground = composite(background, canvas);
  const ink = composite(foreground, ground);
  const lighter = Math.max(luminance(ink), luminance(ground));
  const darker = Math.min(luminance(ink), luminance(ground));
  return (lighter + 0.05) / (darker + 0.05);
}
