// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TopBar } from './TopBar.tsx';
import { useStore } from '../../lib/store.ts';
import { navigate } from '../../lib/router.ts';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const navigateMock = vi.mocked(navigate);

vi.mock('../../lib/router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/router.ts')>();
  return {
    ...actual,
    navigate: vi.fn(),
    usePath: () => '/',
  };
});

vi.mock('./WorkspaceSwitcher.tsx', () => ({
  WorkspaceSwitcher: ({ name }: { name: string }) => <div>{name}</div>,
}));

describe('the minimal top bar', () => {
  it('shows the team name, shell tabs, search, huddle, invite, and the account menu', () => {
    useStore.setState({
      workspaceName: 'Imba',
      currentUser: { id: 'u1', displayName: 'Marko', role: 'owner' },
      status: 'online',
    } as never);

    render(<TopBar onFeedback={vi.fn()} view="messages" minimal />);

    expect(screen.getByText('Imba')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Channels' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Files' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Huddle' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByText('Marko')).toBeTruthy();
    expect(screen.queryByText('Feedback')).toBeNull();
  });

  it('navigates to search from the centred search control', () => {
    useStore.setState({
      workspaceName: 'Imba',
      currentUser: { id: 'u1', displayName: 'Marko', role: 'owner' },
      status: 'online',
    } as never);

    render(<TopBar onFeedback={vi.fn()} view="messages" minimal />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(navigateMock).toHaveBeenCalledWith('/search');
  });
});
