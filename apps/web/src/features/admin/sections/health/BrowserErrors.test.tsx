// @vitest-environment happy-dom
/**
 * Errors browsers reported, on the Health page (ADR 0025's addendum): one row per fault,
 * how often and where, the stack behind it, and a way to clear the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type ClientErrorEntry } from '../../../../lib/api.ts';
import { BrowserErrors } from './BrowserErrors.tsx';

const FAULT: ClientErrorEntry = {
  fingerprint: 'f1',
  message: "TypeError: cannot read 'x' of undefined",
  stack: 'TypeError: x\n    at Ze (https://chat.example/assets/index.js:1:2)',
  path: '/c/{id}',
  release: 'abc1234',
  browser: 'Chrome 130',
  count: 3,
  firstAt: '2026-10-21T09:00:00Z',
  lastAt: '2026-10-21T10:00:00Z',
};

beforeEach(() => {
  vi.spyOn(api.admin, 'clientErrors').mockResolvedValue({ errors: [FAULT] });
  vi.spyOn(api.admin, 'clearClientErrors').mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('errors in browsers', () => {
  it('lists each fault with how often, where and in what', async () => {
    render(<BrowserErrors />);
    expect(await screen.findByText("TypeError: cannot read 'x' of undefined")).toBeTruthy();
    expect(screen.getByText(/3 times, last .* · Chrome 130 · \/c\/\{id\} · build abc1234/)).toBeTruthy();
    expect(screen.getByText(/index\.js:1:2/)).toBeTruthy();
  });

  it('clears the list', async () => {
    render(<BrowserErrors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(api.admin.clearClientErrors).toHaveBeenCalled());
  });

  it('says so when nothing was reported', async () => {
    vi.spyOn(api.admin, 'clientErrors').mockResolvedValue({ errors: [] });
    render(<BrowserErrors />);
    expect(await screen.findByText('No browser has reported an error.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});
