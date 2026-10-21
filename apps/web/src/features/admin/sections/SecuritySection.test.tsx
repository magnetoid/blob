// @vitest-environment happy-dom
/**
 * The Security page (M3 · C3): the workspace's checks, and the server's only when the
 * answer carries them — for whoever runs the server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import { SecuritySection } from './SecuritySection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WORKSPACE = [
  {
    id: 'admins_two_step',
    title: 'Admins sign in with a passkey as well',
    state: 'attention' as const,
    detail: '1 of 2 admins ask for a passkey after the password.',
  },
  { id: 'audit', title: 'Audit log', state: 'info' as const, detail: 'Kept for 365 days.' },
];

describe('the Security page', () => {
  it('says what is worth a look, and leaves the server out for a plain admin', async () => {
    vi.spyOn(api.admin, 'security').mockResolvedValue({ workspace: WORKSPACE, server: null });
    render(<SecuritySection />);
    const workspace = await screen.findByRole('list', { name: 'This workspace' });
    const row = within(workspace).getByText('Admins sign in with a passkey as well').closest('li')!;
    expect(row.getAttribute('data-state')).toBe('attention');
    expect(within(row).getByText('Worth a look')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'This server' })).toBeNull();
  });

  it('shows the server to whoever runs it', async () => {
    vi.spyOn(api.admin, 'security').mockResolvedValue({
      workspace: WORKSPACE,
      server: [
        {
          id: 'cookie',
          title: 'Sessions are bound to this host',
          state: 'ok',
          detail: 'The session cookie is __Host-, Secure and HTTP-only.',
        },
      ],
    });
    render(<SecuritySection />);
    const server = await screen.findByRole('list', { name: 'This server' });
    expect(within(server).getByText('Good')).toBeTruthy();
  });
});
