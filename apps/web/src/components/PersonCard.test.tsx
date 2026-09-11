// @vitest-environment happy-dom
/**
 * The card has to load GET /api/users/{id} when it opens.
 *
 * Bootstrap already has a User, but that row is the directory stub — no timezone,
 * often no fullName. The endpoint exists and had zero product callers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const getUser = vi.fn();
vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, users: { ...actual.api.users, get: (...a: unknown[]) => getUser(...a) } } };
});

const { PersonCard } = await import('./PersonCard.tsx');
const { useStore } = await import('../lib/store.ts');

afterEach(cleanup);

const person = {
  id: 'u1',
  kind: 'human' as const,
  displayName: 'Ana',
  fullName: null,
  title: 'Editor',
  avatarUrl: null,
  timezone: 'UTC',
  role: 'member' as const,
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  deactivated: false,
};

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({
    user: { ...person, fullName: 'Ana Petrović', timezone: 'Europe/Belgrade' },
  });
  useStore.setState({
    currentUser: { id: 'me', displayName: 'Me' },
    users: { u1: person },
  } as never);
});

describe('PersonCard', () => {
  it('fills full name and timezone from GET /api/users/{id}', async () => {
    render(<PersonCard person={person} open onClose={() => {}} />);
    await waitFor(() => {
      expect(getUser).toHaveBeenCalledWith('u1');
      expect(screen.getByText('Ana Petrović')).toBeTruthy();
      expect(screen.getByText('Europe/Belgrade')).toBeTruthy();
    });
  });
});
