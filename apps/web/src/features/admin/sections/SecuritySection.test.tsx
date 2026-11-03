// @vitest-environment happy-dom
/**
 * The Security page (M3 · C3): the workspace's checks, and the server's only when the
 * answer carries them — for whoever runs the server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import * as router from '../../../lib/router.ts';
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
    expect(within(workspace).getAllByRole('listitem')).toHaveLength(2);
    const row = within(workspace)
      .getByText('Admins sign in with a passkey as well')
      .closest('[role="listitem"]') as HTMLElement;
    expect(row.getAttribute('data-state')).toBe('attention');
    expect(within(row).getByText('Worth a look')).toBeTruthy();
    // A quiet choice reads as one, not as a warning.
    const choice = within(workspace).getByText('A choice');
    expect(choice.className).not.toContain('text-destructive');
    expect(within(row).getByText('Worth a look').className).toContain('text-destructive');
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
    // The server's checks are its environment's: they link nowhere.
    expect(within(server).queryByRole('link')).toBeNull();
  });

  it('links a workspace check to the page where it is changed, inside the console', async () => {
    vi.spyOn(api.admin, 'security').mockResolvedValue({ workspace: WORKSPACE, server: null });
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => undefined);
    render(<SecuritySection />);
    const link = await screen.findByRole('link', { name: 'Admins sign in with a passkey as well' });
    expect(link.getAttribute('href')).toBe('/admin/members');

    // A plain click stays in the console; a modified one is somebody asking for a tab.
    fireEvent.click(link, { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/admin/members');
  });

  it('says it is loading rather than that nothing is wrong', () => {
    vi.spyOn(api.admin, 'security').mockReturnValue(new Promise(() => undefined));
    render(<SecuritySection />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
