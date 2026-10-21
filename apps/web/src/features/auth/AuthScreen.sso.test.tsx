// @vitest-environment happy-dom
/** Single sign-on on the sign-in page (ADR 0033): the buttons, and the sentence a refused
 *  round trip comes back with. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const begin = vi.fn(async () => ({ url: 'https://idp.example.com/authorize?x=1' }));
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      auth: { login: vi.fn(), invite: vi.fn(async () => ({ email: null, workspace: 'Acme' })) },
      sso: { begin },
    },
  };
});

const { AuthScreen } = await import('./AuthScreen.tsx');

const ACME = [{ slug: 'acme', name: 'Acme' }];

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign, pathname: '/', search: '', href: 'http://localhost/' },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  cleanup();
});

describe('single sign-on buttons', () => {
  it('starts a round trip and goes to the provider', async () => {
    render(<AuthScreen needsSetup={false} providers={ACME} onSignedIn={vi.fn()} />);
    fireEvent.click(screen.getByText('Continue with Acme'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://idp.example.com/authorize?x=1'));
    expect(begin).toHaveBeenCalledWith({
      provider: 'acme',
      intent: 'sign_in',
      next: undefined,
      invite: undefined,
    });
  });

  it('are not offered when the server has none', () => {
    render(<AuthScreen needsSetup={false} onSignedIn={vi.fn()} />);
    expect(screen.queryByText(/Continue with/)).toBeNull();
  });
});

describe('a refused round trip', () => {
  it('says why, once', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        assign,
        pathname: '/',
        search: '?sso_error=not_linked',
        href: 'http://localhost/?sso_error=not_linked',
      },
      configurable: true,
      writable: true,
    });
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<AuthScreen needsSetup={false} providers={ACME} onSignedIn={vi.fn()} />);
    expect(
      screen.getByText(/Your address already has an account here\. Sign in another way/),
    ).toBeTruthy();
    expect(replace).toHaveBeenCalledWith(null, '', '/');
  });
});
