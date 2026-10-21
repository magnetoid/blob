// @vitest-environment happy-dom
/** Stopping away emails from the link in one (ADR 0036): asked, never on opening. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api, ApiError } from '../../lib/api.ts';
import { UnsubscribeScreen } from './UnsubscribeScreen.tsx';
import { unsubscribeTokenFromUrl } from '../auth/tokens.ts';

const INFO = { email: 'ana@example.com', workspace: 'Northwind', off: false };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('the unsubscribe page', () => {
  it('says whose emails it stops, and stops them only when asked', async () => {
    vi.spyOn(api.mail, 'unsubscribeInfo').mockResolvedValue(INFO);
    const stop = vi.spyOn(api.mail, 'unsubscribe').mockResolvedValue({ ...INFO, off: true });
    render(<UnsubscribeScreen token="tok" />);
    expect(await screen.findByText('ana@example.com')).toBeTruthy();
    expect(stop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Stop these emails' }));
    expect(await screen.findByRole('heading', { name: 'Stopped' })).toBeTruthy();
    expect(stop).toHaveBeenCalledWith('tok');
  });

  it('says so when they are already off', async () => {
    vi.spyOn(api.mail, 'unsubscribeInfo').mockResolvedValue({ ...INFO, off: true });
    render(<UnsubscribeScreen token="tok" />);
    expect(
      await screen.findByRole('heading', { name: 'These emails are already off' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop these emails' })).toBeNull();
  });

  it('points somewhere useful when the link is broken', async () => {
    vi.spyOn(api.mail, 'unsubscribeInfo').mockRejectedValue(
      new ApiError(404, 'not_found', 'That link does not work.'),
    );
    render(<UnsubscribeScreen token="bad" />);
    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Blob' }).getAttribute('href')).toBe(
      '/settings/preferences',
    );
  });
});

describe('the link', () => {
  it('is /unsubscribe with its token in the query, and nothing else is', () => {
    window.history.replaceState(null, '', '/unsubscribe?t=abc.def');
    expect(unsubscribeTokenFromUrl()).toBe('abc.def');
    window.history.replaceState(null, '', '/unsubscribe');
    expect(unsubscribeTokenFromUrl()).toBe('');
    window.history.replaceState(null, '', '/c/general?t=abc');
    expect(unsubscribeTokenFromUrl()).toBeNull();
  });
});
