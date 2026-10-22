/** Single sign-on's words (ADR 0033): what each way a round trip can fail means to the
 *  person who was sent back here, from the code in `?sso_error=`. */

export function ssoMessage(code: string): string {
  switch (code) {
    case 'expired':
      return 'That sign-in took too long, or was started in another browser. Try again.';
    case 'denied':
      return 'The sign-in was cancelled at your identity provider.';
    case 'email_unverified':
      return 'Your identity provider has not confirmed your email address, so it cannot sign you in here.';
    case 'domain':
      return 'Your address is not one this server lets in through single sign-on.';
    case 'not_linked':
      return 'Your address already has an account here. Sign in another way, then link single sign-on under Sign-in & security.';
    case 'linked_elsewhere':
      return 'Your address is already linked to a different account at that provider.';
    case 'no_account':
      return 'There is no account here for your address. Ask an admin for an invitation.';
    case 'invite_expired':
      return 'That invitation has expired or was already used.';
    case 'invite_wrong_address':
      return 'That invitation was issued for a different email address.';
    case 'invite_required':
      return 'Your messages from Slack are waiting here. Ask an admin to invite this address.';
    case 'deactivated':
      return 'That account has been deactivated.';
    case 'invalid_token':
    case 'stale':
      return 'Your identity provider’s answer could not be checked. Try again.';
    case 'unavailable':
    case 'unreachable':
    case 'misconfigured':
      return 'Single sign-on is not working right now. Sign in another way, or tell your administrator.';
    default:
      return 'Single sign-on did not go through. Try again.';
  }
}

/** The `sso_error` a provider's round trip came back with, if any. */
export function ssoErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('sso_error');
}

/** Take `sso_error` (and `sso`) off the address, so a refresh does not say it again. */
export function clearSsoParams(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('sso_error') && !params.has('sso')) return;
  params.delete('sso_error');
  params.delete('sso');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
}
