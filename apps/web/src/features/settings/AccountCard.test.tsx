// @vitest-environment happy-dom
/** Signing out mid-call used to leave the microphone live: `reset()` only forgets the
 * call session, it never disconnected the room, and the app switches to the signed-out
 * screen with no reload to tear anything down incidentally. The button has to hang up
 * first. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const logout = vi.fn();
// `DevicesPanel` (rendered alongside the Sign out button) fetches sessions on mount;
// stubbed so the test is not also a real, failing network call to nowhere.
const sessions = vi.fn().mockResolvedValue({ sessions: [] });
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, auth: { ...actual.api.auth, logout, sessions } } };
});
const leaveCall = vi.fn();
vi.mock('../../lib/calls.ts', () => ({ leaveCall }));

const { AccountCard } = await import('./AccountCard.tsx');
const { useStore } = await import('../../lib/store.ts');

afterEach(cleanup);

describe('signing out', () => {
  it('leaves the call before logging out and resetting the store', async () => {
    const order: string[] = [];
    leaveCall.mockImplementation(async () => {
      order.push('leaveCall');
    });
    logout.mockImplementation(async () => {
      order.push('logout');
    });
    const reset = vi.fn(() => order.push('reset'));
    // The store's own action is swapped for a spy the same way other store tests in
    // this codebase stub one: `setState` merges into the live store, so the component's
    // `useStore((s) => s.reset)` picks this up on its next read.
    useStore.setState({ reset } as never);

    render(<AccountCard onSignedOut={vi.fn()} onError={vi.fn()} isOwner />);
    fireEvent.click(screen.getByText('Sign out'));

    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(order).toEqual(['leaveCall', 'logout', 'reset']);
  });

  it('calls onSignedOut once the store has been reset', async () => {
    const order: string[] = [];
    leaveCall.mockResolvedValue(undefined);
    logout.mockResolvedValue(undefined);
    const reset = vi.fn(() => order.push('reset'));
    useStore.setState({ reset } as never);
    const onSignedOut = vi.fn(() => order.push('onSignedOut'));

    render(<AccountCard onSignedOut={onSignedOut} onError={vi.fn()} isOwner />);
    fireEvent.click(screen.getByText('Sign out'));

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(order).toEqual(['reset', 'onSignedOut']);
  });
});
