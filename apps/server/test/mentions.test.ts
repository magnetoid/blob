import { describe, expect, it } from 'vitest';
import { matchesKeywords, parseMentions } from '@blob/shared';

const names = new Map([
  ['ana', 'user-ana'],
  ['ana maria', 'user-ana-maria'],
  ['marko', 'user-marko'],
]);

describe('parseMentions', () => {
  it('finds a simple mention', () => {
    expect(parseMentions('hey @ana can you look?', names).userIds).toEqual(['user-ana']);
  });

  it('prefers the longest matching name', () => {
    // Otherwise "@Ana Maria" would silently ping the wrong person.
    expect(parseMentions('@Ana Maria ping', names).userIds).toEqual(['user-ana-maria']);
  });

  it('ignores trailing punctuation', () => {
    expect(parseMentions('thanks @ana!', names).userIds).toEqual(['user-ana']);
  });

  it('deduplicates repeated mentions', () => {
    expect(parseMentions('@ana @ana @ana', names).userIds).toEqual(['user-ana']);
  });

  it('recognises @channel and @here', () => {
    expect(parseMentions('@channel heads up', names)).toMatchObject({
      everyone: true,
      hereOnly: false,
    });
    expect(parseMentions('@here quick one', names)).toMatchObject({
      everyone: true,
      hereOnly: true,
    });
  });

  it('never mentions anyone from inside code', () => {
    const fenced = parseMentions('```\n@channel @ana\n```', names);
    expect(fenced.userIds).toEqual([]);
    expect(fenced.everyone).toBe(false);

    const inline = parseMentions('use `@ana` as the flag', names);
    expect(inline.userIds).toEqual([]);
  });

  it('ignores unknown names', () => {
    expect(parseMentions('@nobody hello', names).userIds).toEqual([]);
  });

  it('handles an email address without mentioning anyone', () => {
    expect(parseMentions('write to ana@example.com', names).userIds).toEqual([]);
  });
});

describe('matchesKeywords', () => {
  it('matches on a word boundary', () => {
    expect(matchesKeywords('the deploy failed', ['deploy'])).toBe(true);
  });

  it('does not match inside a larger word', () => {
    expect(matchesKeywords('redeployment finished', ['deploy'])).toBe(false);
  });

  it('is case insensitive', () => {
    expect(matchesKeywords('Postgres is down', ['postgres'])).toBe(true);
  });

  it('ignores keywords inside code blocks', () => {
    expect(matchesKeywords('```\ndeploy\n```', ['deploy'])).toBe(false);
  });

  it('returns false with no keywords configured', () => {
    expect(matchesKeywords('anything at all', [])).toBe(false);
  });
});
