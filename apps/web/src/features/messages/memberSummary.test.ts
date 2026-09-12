/** The two numbers in the channel header. */

import { describe, expect, it } from 'vitest';
import { memberSummary } from './memberSummary.ts';

describe('who is in this channel', () => {
  it('counts people and agents apart', () => {
    expect(memberSummary(14, 3)).toBe('14 members · 3 agents');
  });

  it('says nothing about agents when there are none', () => {
    // A channel without an agent in it should not be made to mention agents.
    expect(memberSummary(14, 0)).toBe('14 members');
  });

  it('counts the agents inside the total, not beside it', () => {
    // The member list the server returns includes the bots, so 14 is everybody and 3 of
    // those 14 are programs. "14 members and 3 more agents" would be 17 and wrong.
    expect(memberSummary(3, 3)).toBe('3 members · 3 agents');
  });

  it('is singular for one of either', () => {
    expect(memberSummary(1, 1)).toBe('1 member · 1 agent');
  });

  it('draws a dash rather than a zero while the list is loading', () => {
    // 0 followed by 14 a moment later reads as people leaving the channel.
    expect(memberSummary(null, 0)).toBe('–');
    expect(memberSummary(null, 5)).toBe('–');
  });

  it('handles an empty channel', () => {
    expect(memberSummary(0, 0)).toBe('0 members');
  });
});
