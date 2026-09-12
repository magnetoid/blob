import { describe, expect, it } from 'vitest';
import { channelName } from '@blob/shared';

describe('channelName', () => {
  it('normalises what it accepts, so the dialog sends what the server will store', () => {
    expect(channelName('  Design-Review ')).toEqual({ ok: true, name: 'design-review' });
  });

  it('says what is wrong before the round trip', () => {
    expect(channelName('   ')).toEqual({ ok: false, message: 'Enter a channel name.' });
    expect(channelName('a'.repeat(65))).toMatchObject({ ok: false });
    expect(channelName('-leading')).toEqual({
      ok: false,
      message: 'Use lowercase letters, numbers, hyphens and underscores.',
    });
    expect(channelName('has space')).toMatchObject({ ok: false });
  });
});
