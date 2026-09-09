import { describe, expect, it } from 'vitest';
import { typingKey } from './typing.ts';

describe('typingKey', () => {
  it('keys the channel on its own', () => {
    expect(typingKey('c1')).toBe('c1');
    expect(typingKey('c1', null)).toBe('c1');
  });

  it('keeps a thread off the channel key', () => {
    expect(typingKey('c1', 'm9')).toBe('c1:m9');
    expect(typingKey('c1')).not.toBe(typingKey('c1', 'm9'));
  });
});
