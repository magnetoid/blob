// @vitest-environment happy-dom
/** The server console mounts the machine's pages under one nav with no headings and no
 * badges, and Accounts keeps its card whatever follows /server/users/ — it shows the
 * list, and the list needs its card like anywhere else. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { useStore } from '../../lib/store.ts';

vi.mock('../shell/TopBar.tsx', () => ({ TopBar: () => <div>top bar</div> }));
vi.mock('../admin/sections/AccountsSection.tsx', () => ({
  AccountsSection: () => <div>accounts-part</div>,
}));
vi.mock('../admin/sections/health/HealthSection.tsx', () => ({
  HealthSection: () => <div>health-part</div>,
}));

const { ServerConsole } = await import('./ServerConsole.tsx');

afterEach(() => {
  cleanup();
  useStore.setState({ currentUser: null });
});

function signIn(role: 'admin' | 'owner', isInstanceAdmin: boolean) {
  useStore.setState({ currentUser: { id: 'me', role, isInstanceAdmin } as never });
}

describe('the server console', () => {
  it('is one list of the machine’s pages, under no heading and with no badge', () => {
    signIn('admin', true);
    render(<ServerConsole section="health" onFeedback={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    expect(within(nav).queryAllByRole('heading')).toEqual([]);
    expect([...nav.querySelectorAll('.channel-name')].map((n) => n.textContent)).toEqual([
      'Health',
      'Accounts',
      'Single sign-on',
      'App policy',
      'Errors and logs',
    ]);
    expect(within(nav).queryByText('Server')).toBeNull();
    expect(screen.getByText('This server')).toBeTruthy();
    expect(screen.getByText('health-part')).toBeTruthy();
  });

  it('keeps Accounts in its card under a detail id', () => {
    signIn('owner', true);
    render(<ServerConsole section="users" detailId="u1" onFeedback={vi.fn()} />);
    expect(screen.getByText('accounts-part').closest('.console-card')).toBeTruthy();
  });
});
