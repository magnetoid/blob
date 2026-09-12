import { describe, expect, it } from 'vitest';
import { byDisplayName, formatBytes } from './format.ts';

describe('formatBytes', () => {
  it('reads the way the three copies it replaced read', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(900_000)).toBe('879 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});

describe('byDisplayName', () => {
  it('sorts people by the name they chose', () => {
    const names = [{ displayName: 'Zed' }, { displayName: 'ana' }, { displayName: 'Bo' }];
    expect(names.sort(byDisplayName).map((p) => p.displayName)).toEqual(['ana', 'Bo', 'Zed']);
  });
});
