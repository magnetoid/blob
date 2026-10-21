// @vitest-environment happy-dom
/** Signing in with a passkey, and the passkey after a password (ADR 0032). The browser's
 *  half is `lib/passkeys.ts`, stubbed here; this is what the screen does around it. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CREDENTIAL = { id: 'cred', rawId: 'cred', type: 'public-key', response: {} };
const CHALLENGE = { flowId: 'flow-1234567890', options: { challenge: 'abc' } };

const login = vi.fn();
const resetPassword = vi.fn();
const signInOptions = vi.fn(async () => CHALLENGE);
const signIn = vi.fn(async () => ({ user: { id: 'u1' } }));
const secondStep = vi.fn(async () => ({ user: { id: 'u1' } }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      auth: { login, resetPassword, invite: vi.fn(), signup: vi.fn(), forgotPassword: vi.fn() },
      passkeys: { signInOptions, signIn, secondStep },
    },
  };
});

const getPasskey = vi.fn(async () => CREDENTIAL);
vi.mock('../../lib/passkeys.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/passkeys.ts')>();
  return {
    ...actual,
    passkeysSupported: () => true,
    autofillAvailable: async () => false,
    getPasskey: (...args: unknown[]) => getPasskey(...(args as [])),
  };
});

const { AuthScreen } = await import('./AuthScreen.tsx');
const { ApiError } = await import('../../lib/api.ts');

function renderScreen() {
  const onSignedIn = vi.fn(async () => {});
  render(<AuthScreen needsSetup={false} onSignedIn={onSignedIn} />);
  return { onSignedIn };
}

function typeAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByText('Sign in', { selector: 'button' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('a passkey alone', () => {
  it('signs in with no address typed', async () => {
    const { onSignedIn } = renderScreen();
    fireEvent.click(screen.getByText('Sign in with a passkey'));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(getPasskey).toHaveBeenCalledWith(CHALLENGE.options);
    expect(signIn).toHaveBeenCalledWith(CHALLENGE.flowId, CREDENTIAL);
    expect(login).not.toHaveBeenCalled();
  });

  it('says nothing when the person closes the prompt', async () => {
    getPasskey.mockRejectedValueOnce(new DOMException('closed', 'NotAllowedError'));
    const { onSignedIn } = renderScreen();
    fireEvent.click(screen.getByText('Sign in with a passkey'));

    await waitFor(() => expect(getPasskey).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText('Sign in with a passkey').closest('button')?.disabled).toBe(false),
    );
    expect(document.querySelector('.error-text')).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('says why when the server refuses it', async () => {
    signIn.mockRejectedValueOnce(
      new ApiError(400, 'passkey_unknown', 'That passkey is no longer on any account here.'),
    );
    renderScreen();
    fireEvent.click(screen.getByText('Sign in with a passkey'));
    expect(
      await screen.findByText('That passkey is no longer on any account here.'),
    ).toBeTruthy();
  });

  it('lets the browser offer passkeys in the email field', () => {
    renderScreen();
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username webauthn');
  });
});

describe('a passkey after the password', () => {
  it('finishes the sign-in once the passkey answers', async () => {
    login.mockResolvedValueOnce({ user: null, twoStep: CHALLENGE });
    const { onSignedIn } = renderScreen();
    typeAndSubmit();

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(secondStep).toHaveBeenCalledWith(CHALLENGE.flowId, CREDENTIAL);
  });

  it('waits on a button when the prompt was closed, and asks again from it', async () => {
    login.mockResolvedValueOnce({ user: null, twoStep: CHALLENGE });
    getPasskey.mockRejectedValueOnce(new DOMException('closed', 'NotAllowedError'));
    const { onSignedIn } = renderScreen();
    typeAndSubmit();

    expect(await screen.findByText('One more step')).toBeTruthy();
    const again = await screen.findByText('Use your passkey');
    await waitFor(() => expect(again.closest('button')?.disabled).toBe(false));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(again);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it('starts over when the server refuses the passkey', async () => {
    login.mockResolvedValueOnce({ user: null, twoStep: CHALLENGE });
    secondStep.mockRejectedValueOnce(
      new ApiError(400, 'passkey_refused', 'That passkey belongs to someone else.'),
    );
    renderScreen();
    typeAndSubmit();

    expect(await screen.findByText('That passkey belongs to someone else.')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText('One more step')).toBeNull();
  });
});

describe('a reset for somebody who asks for a passkey', () => {
  it('ends on the sign-in form rather than signed in', async () => {
    window.history.replaceState(null, '', '/reset/abc123def456');
    resetPassword.mockResolvedValueOnce({ ok: true, signedIn: false });
    const { onSignedIn } = renderScreen();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByText('Save and sign in'));

    expect(
      await screen.findByText('Your password is changed. Sign in with it, then your passkey.'),
    ).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });
});
