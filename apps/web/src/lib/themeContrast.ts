interface Rgb {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface ContrastPair {
  foreground: string;
  background: string;
  minimum: number;
  label: string;
}

const PAIRS: ContrastPair[] = [
  {
    foreground: '--text',
    background: '--bg',
    minimum: 4.5,
    label: 'primary text on page',
  },
  {
    foreground: '--text-body',
    background: '--bg',
    minimum: 4.5,
    label: 'message text on page',
  },
  {
    foreground: '--text-2',
    background: '--bg',
    minimum: 4.5,
    label: 'secondary text on page',
  },
  {
    foreground: '--text-faint',
    background: '--bg',
    minimum: 4.5,
    label: 'faint text on page',
  },
  {
    foreground: '--text',
    background: '--surface',
    minimum: 4.5,
    label: 'primary text on surfaces',
  },
  {
    foreground: '--text',
    background: '--bg-sidebar',
    minimum: 4.5,
    label: 'primary text in the sidebar',
  },
  {
    foreground: '--accent-contrast',
    background: '--accent',
    minimum: 4.5,
    label: 'text on primary actions',
  },
  {
    foreground: '--danger',
    background: '--bg',
    minimum: 4.5,
    label: 'danger text on page',
  },
];

function parseColor(value: string | undefined): Rgb | null {
  if (!value) return null;
  const text = value.trim();
  const short = text.match(/^#([\da-f])([\da-f])([\da-f])([\da-f])?$/i);
  if (short) {
    return {
      red: Number.parseInt(`${short[1]}${short[1]}`, 16),
      green: Number.parseInt(`${short[2]}${short[2]}`, 16),
      blue: Number.parseInt(`${short[3]}${short[3]}`, 16),
      alpha: short[4] ? Number.parseInt(`${short[4]}${short[4]}`, 16) / 255 : 1,
    };
  }
  const hex = text.match(
    /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i,
  );
  if (hex) {
    return {
      red: Number.parseInt(hex[1] ?? '0', 16),
      green: Number.parseInt(hex[2] ?? '0', 16),
      blue: Number.parseInt(hex[3] ?? '0', 16),
      alpha: hex[4] ? Number.parseInt(hex[4], 16) / 255 : 1,
    };
  }
  const rgb = text.match(/^rgba?\((.+)\)$/);
  if (!rgb?.[1]) return null;
  const parts = rgb[1].replace(/[,/]/g, ' ').trim().split(/\s+/);
  if (parts.length < 3) return null;
  const channel = (part: string) => {
    const value = part.endsWith('%')
      ? (Number(part.slice(0, -1)) / 100) * 255
      : Number(part);
    return Math.max(0, Math.min(255, value));
  };
  const parsedAlpha = parts[3]?.endsWith('%')
    ? Number(parts[3].slice(0, -1)) / 100
    : Number(parts[3] ?? 1);
  if (![...parts.slice(0, 3).map(channel), parsedAlpha].every(Number.isFinite)) {
    return null;
  }
  return {
    red: channel(parts[0] ?? '0'),
    green: channel(parts[1] ?? '0'),
    blue: channel(parts[2] ?? '0'),
    alpha: Math.max(0, Math.min(1, parsedAlpha)),
  };
}

function composite(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  const channel = (front: number, back: number) =>
    alpha === 0
      ? 0
      : (front * foreground.alpha +
          back * background.alpha * (1 - foreground.alpha)) /
        alpha;
  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  };
}

function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.red) +
    0.7152 * channel(color.green) +
    0.0722 * channel(color.blue)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundRgb = parseColor(foreground);
  const backgroundRgb = parseColor(background);
  if (!foregroundRgb || !backgroundRgb) return 1;
  const canvas = { red: 255, green: 255, blue: 255, alpha: 1 };
  const renderedBackground = composite(backgroundRgb, canvas);
  const renderedForeground = composite(foregroundRgb, renderedBackground);
  const lighter = Math.max(
    luminance(renderedForeground),
    luminance(renderedBackground),
  );
  const darker = Math.min(
    luminance(renderedForeground),
    luminance(renderedBackground),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

export function themeContrastIssues(tokens: Record<string, string>): string[] {
  return PAIRS.flatMap((pair) => {
    const foreground = tokens[pair.foreground];
    const background = tokens[pair.background];
    if (!foreground || !background) return [];
    const ratio = contrastRatio(foreground, background);
    return ratio < pair.minimum
      ? [`${pair.label} is ${ratio.toFixed(2)}:1; it needs ${pair.minimum}:1`]
      : [];
  });
}
