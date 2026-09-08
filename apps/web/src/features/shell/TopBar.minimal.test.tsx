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
  it('shows only the team name and search', () => {
    useStore.setState({
      workspaceName: 'Imba',
      currentUser: { id: 'u1', displayName: 'Marko', role: 'owner' },
      status: 'online',
    } as never);

    render(<TopBar onFeedback={vi.fn()} view="messages" minimal />);

    expect(screen.getByText('Imba')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect(screen.queryByText('Messages')).toBeNull();
    expect(screen.queryByText('Feedback')).toBeNull();
  });

  it('navigates to search from the only remaining action', () => {
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
