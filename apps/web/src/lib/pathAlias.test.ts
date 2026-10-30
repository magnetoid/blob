import { describe, expect, it } from 'vitest';
// Nothing but shadcn's generated components uses `@/` yet, and they are not imported by
// anything, so without this the alias could rot unseen: `tsc` resolves it through
// `paths` in tsconfig.json (no `baseUrl`, which TypeScript 6 deprecates) and Vite and
// Vitest through `resolve.alias` in vite.config.ts. A broken either side fails here.
import { toHex } from '@/lib/color.ts';
import { toHex as direct } from './color.ts';

describe('the @/ alias', () => {
  it('reaches src/ from the type checker and from the bundler alike', () => {
    expect(toHex('#fafafa')).toBe('#fafafa');
    expect(toHex).toBe(direct);
  });
});
