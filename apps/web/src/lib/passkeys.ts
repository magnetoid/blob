/** Passkeys in the browser (ADR 0032).
 *
 * Nothing but the platform: `PublicKeyCredential.parse*OptionsFromJSON` turns the server's
 * options into what `navigator.credentials` takes, and `credential.toJSON()` turns the
 * answer back — Chrome 129, Firefox 119 and Safari 18.4 all have both, so no WebAuthn
 * library rides along. The server decides everything; this only carries the ceremony.
 */

/** Whether this browser can make and use passkeys at all. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
  );
}

/** Whether the browser will offer passkeys in the email field's autofill. */
export async function autofillAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return (await PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
  } catch {
    return false;
  }
}

/** The person closed the prompt, let it time out, or another prompt took its place:
 *  nothing to say about it. */
export function isCancel(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
  );
}

/** Make a passkey for these options; the answer as the server reads it. */
export async function createPasskey(options: unknown): Promise<PublicKeyCredentialJSON> {
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
    options as PublicKeyCredentialCreationOptionsJSON,
  );
  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('No passkey was made.', 'NotAllowedError');
  return credential.toJSON();
}

/**
 * Answer a challenge with a passkey the person picks.
 *
 * `autofill` waits quietly for the person to pick one from the email field's suggestions
 * instead of opening a prompt; it has to be aborted (`signal`) before anything else asks,
 * because a browser holds one WebAuthn request at a time.
 */
export async function getPasskey(
  options: unknown,
  { autofill = false, signal }: { autofill?: boolean; signal?: AbortSignal } = {},
): Promise<PublicKeyCredentialJSON> {
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(
    options as PublicKeyCredentialRequestOptionsJSON,
  );
  const credential = (await navigator.credentials.get({
    publicKey,
    mediation: autofill ? 'conditional' : 'optional',
    signal,
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('No passkey was used.', 'NotAllowedError');
  return credential.toJSON();
}

/**
 * Tell the person's password manager that a key no longer opens anything here, so it
 * stops offering it — the Signal API, in Chrome and Safari; Firefox has none. A courtesy
 * the server does not depend on, so any failure is ignored.
 */
export function forgetPasskey(credentialId: string): void {
  const signal = (
    PublicKeyCredential as unknown as {
      signalUnknownCredential?: (input: { rpId: string; credentialId: string }) => Promise<void>;
    }
  ).signalUnknownCredential;
  if (typeof signal !== 'function') return;
  void signal
    .call(PublicKeyCredential, { rpId: window.location.hostname, credentialId })
    .catch(() => undefined);
}
