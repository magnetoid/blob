// @vitest-environment happy-dom
/** The browser half of a passkey ceremony: the platform's JSON helpers, carried. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPasskey,
  forgetPasskey,
  getPasskey,
  isCancel,
  passkeysSupported,
} from './passkeys.ts';

const JSON_ANSWER = { id: 'cred', rawId: 'cred', type: 'public-key', response: {} };

function platform({ signal }: { signal?: ReturnType<typeof vi.fn> } = {}) {
  const parsedCreate = { parsed: 'create' };
  const parsedGet = { parsed: 'get' };
  const credential = { toJSON: () => JSON_ANSWER };
  const PublicKeyCredential = Object.assign(function PublicKeyCredential() {}, {
    parseCreationOptionsFromJSON: vi.fn(() => parsedCreate),
    parseRequestOptionsFromJSON: vi.fn(() => parsedGet),
    isConditionalMediationAvailable: vi.fn(async () => true),
    ...(signal ? { signalUnknownCredential: signal } : {}),
  });
  const credentials = { create: vi.fn(async () => credential), get: vi.fn(async () => credential) };
  vi.stubGlobal('PublicKeyCredential', PublicKeyCredential);
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
  return { PublicKeyCredential, credentials, parsedCreate, parsedGet };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('passkeys in the browser', () => {
  it('needs the JSON helpers, not only WebAuthn', () => {
    expect(passkeysSupported()).toBe(false);
    platform();
    expect(passkeysSupported()).toBe(true);
  });

  it('makes one from the server’s options and answers in its JSON', async () => {
    const { credentials, parsedCreate } = platform();
    expect(await createPasskey({ challenge: 'abc' })).toEqual(JSON_ANSWER);
    expect(credentials.create).toHaveBeenCalledWith({ publicKey: parsedCreate });
  });

  it('asks quietly through autofill, and can be stopped', async () => {
    const { credentials, parsedGet } = platform();
    const controller = new AbortController();
    await getPasskey({ challenge: 'abc' }, { autofill: true, signal: controller.signal });
    expect(credentials.get).toHaveBeenCalledWith({
      publicKey: parsedGet,
      mediation: 'conditional',
      signal: controller.signal,
    });
  });

  it('treats a closed prompt as nothing to report', () => {
    expect(isCancel(new DOMException('closed', 'NotAllowedError'))).toBe(true);
    expect(isCancel(new DOMException('stopped', 'AbortError'))).toBe(true);
    expect(isCancel(new DOMException('bad', 'SecurityError'))).toBe(false);
    expect(isCancel(new Error('NotAllowedError'))).toBe(false);
  });

  it('tells the password manager about a removed key where the browser can', () => {
    const signal = vi.fn(async () => undefined);
    platform({ signal });
    forgetPasskey('cred-id');
    expect(signal).toHaveBeenCalledWith({ rpId: window.location.hostname, credentialId: 'cred-id' });
  });

  it('and does nothing where it cannot', () => {
    platform();
    expect(() => forgetPasskey('cred-id')).not.toThrow();
  });
});
