// @vitest-environment happy-dom
/**
 * The page an assistant's sign-in sends a person to (ADR 0029).
 *
 * Pinned: what is said before anybody says yes — the app's name, who confirms it or that
 * nothing does, where the answer goes, and that a program on this computer is called out —
 * that posting is off unless ticked, and that every way out goes where the server said and
 * nowhere the page made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, ApiError, type OAuthConsentRequest } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { ConsentScreen } from './ConsentScreen.tsx';
import { leave } from './consent.ts';

const REQUEST: OAuthConsentRequest = {
  id: 'r1',
  clientName: 'Claude',
  vouchedBy: 'claude.ai',
  redirectHost: 'claude.ai',
  local: false,
  scopes: ['read', 'write'],
};

const BACK = 'https://claude.ai/api/mcp/auth_callback?code=c0de&state=s&iss=https%3A%2F%2Fblob';

let left: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'u1', displayName: 'Ana' } as never,
    workspaceName: 'Acme',
  });
  window.history.replaceState(null, '', '/oauth/authorize?client_id=x&state=s');
  left = vi.spyOn(leave, 'to').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function asks(request: OAuthConsentRequest = REQUEST) {
  return vi
    .spyOn(api.oauth, 'authorize')
    .mockResolvedValue({ request, redirectTo: null });
}

describe('the question', () => {
  it('names the app, who confirms it and where the answer goes', async () => {
    const authorize = asks();
    render(<ConsentScreen />);

    expect(
      await screen.findByRole('heading', { name: 'Connect Claude to Acme?' }),
    ).toBeTruthy();
    expect(authorize).toHaveBeenCalledWith('?client_id=x&state=s');
    expect(screen.getByText(/It will act as you, Ana/)).toBeTruthy();
    expect(screen.getByText(/confirms this is its app/)).toBeTruthy();
    expect(screen.getByText(/Your answer goes to/).textContent).toContain('claude.ai');
  });

  it('calls out an app nothing vouches for, headed for a program on this computer', async () => {
    asks({ ...REQUEST, vouchedBy: null, local: true, redirectHost: '127.0.0.1' });
    render(<ConsentScreen />);

    expect(await screen.findByText(/Nothing confirms this app’s name/)).toBeTruthy();
    expect(screen.getByText(/a program on this computer/)).toBeTruthy();
    expect(screen.queryByText(/confirms this is its app/)).toBeNull();
  });

  it('offers no posting to an app that only asked to read', async () => {
    asks({ ...REQUEST, scopes: ['read'] });
    render(<ConsentScreen />);
    await screen.findByRole('heading', { name: 'Connect Claude to Acme?' });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('the answer', () => {
  it('connects to read only, unless posting is ticked, and goes where the server says', async () => {
    asks();
    const decide = vi.spyOn(api.oauth, 'decide').mockResolvedValue({ redirectTo: BACK });
    render(<ConsentScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('r1', true, false));
    await waitFor(() => expect(left).toHaveBeenCalledWith(BACK));
    expect(screen.getByRole('heading', { name: 'Sending you back' })).toBeTruthy();
  });

  it('asks for posting when the box is ticked', async () => {
    asks();
    const decide = vi.spyOn(api.oauth, 'decide').mockResolvedValue({ redirectTo: BACK });
    render(<ConsentScreen />);

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('r1', true, true));
  });

  it('says no with Cancel, ticked box or not', async () => {
    asks();
    const decide = vi.spyOn(api.oauth, 'decide').mockResolvedValue({ redirectTo: BACK });
    render(<ConsentScreen />);

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('r1', false, false));
  });
});

describe('when there is nothing to ask', () => {
  it('says why a request cannot go ahead, and goes nowhere', async () => {
    vi.spyOn(api.oauth, 'authorize').mockRejectedValue(
      new ApiError(400, 'oauth_request_invalid', 'That app is not one this server knows.'),
    );
    render(<ConsentScreen />);

    expect(await screen.findByText('That app is not one this server knows.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Acme' }).getAttribute('href')).toBe('/');
    expect(left).not.toHaveBeenCalled();
  });

  it('sends a known app its own error straight back', async () => {
    const back = 'https://claude.ai/cb?error=invalid_request&state=s';
    vi.spyOn(api.oauth, 'authorize').mockResolvedValue({ request: null, redirectTo: back });
    render(<ConsentScreen />);
    await waitFor(() => expect(left).toHaveBeenCalledWith(back));
  });

  it('says so when the question expired while it waited', async () => {
    asks();
    vi.spyOn(api.oauth, 'decide').mockRejectedValue(
      new ApiError(400, 'oauth_request_invalid', 'This request has expired. Start again from the app.'),
    );
    render(<ConsentScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/This request has expired/)).toBeTruthy();
    expect(left).not.toHaveBeenCalled();
  });
});
