// @vitest-environment happy-dom
/** Password recovery, which is the half of this screen that did not exist.
 *
 * The server has minted reset tokens and emailed links to `/reset/<token>` since the
 * beginning; nothing in the client read that path, so the link opened the app and did
 * nothing. The assertion that keeps that from happening again is the first one here:
 * the path shape, pinned on this side to match `test_password_reset.py` on the other.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthScreen } from './AuthScreen.tsx';
import { resetTokenFromUrl } from './tokens.ts';

const forgotPassword = vi.fn(async () => ({ ok: true as const }));
const resetPassword = vi.fn(async () => ({ ok: true as const }));
const login = vi.fn(async () => ({ ok: true as const }));

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      auth: {
        forgotPassword: (...args: unknown[]) => forgotPassword(...(args as [])),
        resetPassword: (...args: unknown[]) => resetPassword(...(args as [])),
        login: (...args: unknown[]) => login(...(args as [])),
        invite: vi.fn(),
        signup: vi.fn(),
      },
    },
  };
});

function at(path: string) {
  window.history.replaceState(null, '', path);
}

function renderScreen() {
  const onSignedIn = vi.fn(async () => {});
  render(<AuthScreen needsSetup={false} onSignedIn={onSignedIn} />);
  return { onSignedIn };
}

beforeEach(() => {
  vi.clearAllMocks();
  at('/');
});
afterEach(cleanup);

describe('reading the token off the path', () => {
  it('matches the URL the reset email actually contains', () => {
    at('/reset/abc123def456');
    // Kept identical to `f"{PUBLIC_URL}/reset/{token}"` in routers/auth.py. Change one
    // side alone and every reset email in the wild stops working, silently.
    expect(resetTokenFromUrl()).toBe('abc123def456');
  });

  it('is null anywhere else, including the invite path', () => {
    at('/');
    expect(resetTokenFromUrl()).toBeNull();
    at('/join/some-invite');
    expect(resetTokenFromUrl()).toBeNull();
    at('/reset');
    expect(resetTokenFromUrl()).toBeNull();
  });
});

describe('asking for a link', () => {
  it('is offered from the sign-in form', () => {
    renderScreen();
    expect(screen.getByText('Forgot your password?')).toBeTruthy();
  });

  it('asks for an address and nothing else', () => {
    renderScreen();
    fireEvent.click(screen.getByText('Forgot your password?'));
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.queryByText('Password')).toBeNull();
  });

  it('confirms without saying whether the account exists', async () => {
    renderScreen();
    fireEvent.click(screen.getByText('Forgot your password?'));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.click(screen.getByText('Email me a link'));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('ana@example.com'));
    // "If that address has an account" — the server refuses to enumerate accounts and
    // the screen must not undo that by wording the two outcomes differently.
    const note = await screen.findByText(/If ana@example.com has an account/);
    expect(note.textContent).toMatch(/has an account/);
  });
});

describe('following the link', () => {
  it('opens straight into choosing a new password', () => {
    at('/reset/abc123def456');
    renderScreen();
    expect(screen.getByText('Choose a new password')).toBeTruthy();
    expect(screen.getByText('New password')).toBeTruthy();
    // No address: the token already says who this is, and asking would let somebody
    // aim a valid token at an account it was not minted for.
    expect(screen.queryByText('Email')).toBeNull();
  });

  it('sends the token from the path and then signs in', async () => {
    at('/reset/abc123def456');
    const { onSignedIn } = renderScreen();

    fireEvent.change(screen.getByLabelText(/New password/), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByText('Save and sign in'));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith('abc123def456', 'a-long-enough-password'),
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    // Spent — a refresh must not replay it against the password just chosen.
    expect(window.location.pathname).toBe('/');
  });

  it('holds a new password to the same length signup does', () => {
    at('/reset/abc123def456');
    renderScreen();
    const field = screen.getByLabelText(/New password/) as HTMLInputElement;
    expect(field.minLength).toBe(10);
  });
});
