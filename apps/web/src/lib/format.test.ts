import { describe, expect, it } from 'vitest';
import { byDisplayName, formatBytes, formatTokens } from './format.ts';

describe('formatBytes', () => {
  it('reads the way the three copies it replaced read', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(900_000)).toBe('879 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});

describe('formatTokens', () => {
  it('reads like a meter, not a ledger', () => {
    expect(formatTokens(1)).toBe('1 token');
    expect(formatTokens(380)).toBe('380 tokens');
    expect(formatTokens(1_234)).toBe('1.2k tokens');
    expect(formatTokens(48_700)).toBe('49k tokens');
    expect(formatTokens(1_340_000)).toBe('1.3M tokens');
  });
});

describe('byDisplayName', () => {
  it('sorts people by the name they chose', () => {
    const names = [{ displayName: 'Zed' }, { displayName: 'ana' }, { displayName: 'Bo' }];
    expect(names.sort(byDisplayName).map((p) => p.displayName)).toEqual(['ana', 'Bo', 'Zed']);
  });
});
