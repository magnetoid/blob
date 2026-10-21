// @vitest-environment happy-dom
/**
 * The first-run form asks for the server's setup token when the server has one (M3 · C3),
 * takes it from a `?setup=` link, and sends it only to found the first workspace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthScreen } from './AuthScreen.tsx';

const signup = vi.fn<(input: Record<string, unknown>) => Promise<{ user: { id: string } }>>(
  async () => ({ user: { id: 'u1' } }),
);

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: {
        ...actual.api.auth,
        signup: (input: Record<string, unknown>) => signup(input),
      },
    },
  };
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  signup.mockClear();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('founding a server that has a setup token', () => {
  it('asks for it, takes it from the link, and sends it', async () => {
    window.history.replaceState(null, '', '/?setup=from-the-link');
    render(<AuthScreen needsSetup setupTokenRequired onSignedIn={vi.fn(async () => {})} />);

    expect((screen.getByLabelText('Setup token') as HTMLInputElement).value).toBe('from-the-link');
    fill('Workspace name', 'Acme');
    fill('Display name', 'Ana');
    fill('Email', 'ana@example.com');
    fireEvent.change(document.querySelector('#auth-password')!, {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(signup).toHaveBeenCalled());
    expect(signup.mock.calls[0]![0]).toMatchObject({ setupToken: 'from-the-link' });
  });

  it('says nothing about a token when the server has none', () => {
    render(<AuthScreen needsSetup onSignedIn={vi.fn(async () => {})} />);
    expect(screen.queryByLabelText('Setup token')).toBeNull();
  });
});
