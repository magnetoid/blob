// @vitest-environment happy-dom
/**
 * Errors browsers reported, on the Health page (ADR 0025's addendum): one row per fault,
 * how often and where, the stack behind it, and a way to clear the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(within(screen.getByRole('list', { name: 'Errors in browsers' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('opens the stack under its fault, in a box that scrolls inside itself', async () => {
    render(<BrowserErrors />);
    // Named by the fault it opens, and the stack is not on the page until it is asked for.
    const open = await screen.findByRole('button', {
      name: "Stack TypeError: cannot read 'x' of undefined",
    });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.getAttribute('aria-controls')).toBeNull();
    expect(screen.queryByText(/index\.js:1:2/)).toBeNull();

    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const stack = document.getElementById(open.getAttribute('aria-controls')!)!;
    expect(stack.textContent).toMatch(/index\.js:1:2/);
    // Monospace and bounded: the page body never scrolls sideways for a long frame.
    expect(stack.className).toContain('font-mono');
    expect(stack.className).toContain('max-h-');
    expect(stack.className).toContain('overflow-auto');

    fireEvent.click(open);
    expect(screen.queryByText(/index\.js:1:2/)).toBeNull();
  });

  it('has no Stack button for a fault that kept none', async () => {
    vi.spyOn(api.admin, 'clientErrors').mockResolvedValue({ errors: [{ ...FAULT, stack: '' }] });
    render(<BrowserErrors />);
    await screen.findByText("TypeError: cannot read 'x' of undefined");
    expect(screen.queryByRole('button', { name: /^Stack/ })).toBeNull();
  });

  it('clears the list', async () => {
    render(<BrowserErrors />);
    const clear = await screen.findByRole('button', { name: 'Clear' });
    clear.focus();
    fireEvent.click(clear);
    fireEvent.click(clear);
    await waitFor(() => expect(api.admin.clearClientErrors).toHaveBeenCalled());
    // Once, however many presses; and the button that was pressed keeps focus meanwhile.
    expect(api.admin.clearClientErrors).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(clear);
  });

  it('says so when nothing was reported', async () => {
    vi.spyOn(api.admin, 'clientErrors').mockResolvedValue({ errors: [] });
    render(<BrowserErrors />);
    expect(await screen.findByText('No browser has reported an error.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});
