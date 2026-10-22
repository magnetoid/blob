/** What single sign-on says when it sends somebody back without signing them in. */

import { describe, expect, it } from 'vitest';
import { ssoMessage } from './sso.ts';

describe('a sign-on that came back', () => {
  it('sends somebody whose Slack history is waiting to an admin for an invitation', () => {
    // ADR 0042: an account an import kept is claimed by an invitation to its address, and
    // a provider's domain rule alone does not hand it over.
    expect(ssoMessage('invite_required')).toBe(
      'Your messages from Slack are waiting here. Ask an admin to invite this address.',
    );
  });

  it('says something useful for a code it does not know', () => {
    expect(ssoMessage('something_new')).toBe('Single sign-on did not go through. Try again.');
  });
});
