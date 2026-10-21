/** Words for the devices and sign-ins on the Sign-in & security page. */

import type { AccountEvent } from '../../lib/api.ts';

/** "Chrome on macOS", best effort, because a raw user-agent string helps nobody. */
export function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = userAgent.includes('Firefox/')
    ? 'Firefox'
    : userAgent.includes('Edg/')
      ? 'Edge'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  // Phones first: an iPhone says it is "like Mac OS X", and Android says it is Linux.
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : userAgent.includes('Android')
      ? 'Android'
      : userAgent.includes('Mac OS X')
        ? 'macOS'
        : userAgent.includes('Windows')
          ? 'Windows'
          : userAgent.includes('Linux')
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

/** How a browser signed in, as the end of "Signed in …". */
export function describeMethod(method: string | null): string | null {
  switch (method) {
    case 'password':
      return 'with a password';
    case 'passkey':
      return 'with a passkey';
    case 'two_step':
      return 'with a password and a passkey';
    case 'sso':
      return 'with single sign-on';
    case 'reset':
      return 'from a password reset link';
    case 'signup':
      return 'when the account was made';
    default:
      return null;
  }
}

/** One line of the record, in words. */
export function describeEvent(event: Pick<AccountEvent, 'kind' | 'method'>): string {
  const how = describeMethod(event.method);
  switch (event.kind) {
    case 'signed_in':
      return how ? `Signed in ${how}` : 'Signed in';
    case 'confirmed':
      return how ? `Confirmed it was you ${how}` : 'Confirmed it was you';
    case 'failed':
      return event.method === 'password' ? 'Wrong password entered' : 'Sign-in refused';
    case 'password_changed':
      return 'Password changed';
    case 'signed_out_elsewhere':
      return 'Signed out everywhere else';
    case 'session_ended':
      return 'Signed a device out';
    case 'passkey_added':
      return 'Passkey added';
    case 'passkey_removed':
      return 'Passkey removed';
    case 'two_step_on':
      return 'Started asking for a passkey after the password';
    case 'two_step_off':
      return 'Stopped asking for a passkey after the password';
    case 'sso_linked':
      return 'Single sign-on linked';
    case 'sso_unlinked':
      return 'Single sign-on unlinked';
  }
}
