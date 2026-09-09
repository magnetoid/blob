// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

// The sidebar navigates and opens DMs; neither is what these tests are about.
vi.mock('../../lib/router.ts', async () => ({
  navigate: vi.fn(),
  parseRoute: () => ({ view: 'messages' }),
  usePath: () => '/',
}));

const ME = { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false };
const MATE = { id: 'u2', kind: 'human', displayName: 'Ana', deactivated: false };

function seed() {
  useStore.setState({
    workspaceName: 'Imba',
    currentUser: { ...ME, role: 'owner' },
    users: { u1: ME, u2: MATE },
    channels: {
      c1: {
        id: 'c1',
        kind: 'public',
        name: 'general',
        membership: { isStarred: false },
        archivedAt: null,
        memberIds: ['u1'],
      },
    },
    presence: {},
    savedMessageIds: new Set(),
  } as never);
}

describe('the sidebar header', () => {
  it('does not repeat the workspace name, but still says how large it is', () => {
    seed();
    render(<Sidebar />);

    expect(screen.queryByText('Imba')).toBeNull();
    expect(screen.getByText('2 members')).toBeTruthy();
  });

  it('offers a collapse control instead of a workspace-name header', () => {
    seed();
    render(<Sidebar onToggleCollapse={vi.fn()} />);

    expect(screen.getByLabelText('Collapse left menu')).toBeTruthy();
  });

  it('has no search button, because the bar and ⌘F already have one', () => {
    seed();
    const { container } = render(<Sidebar />);

    expect(container.querySelector('.search-trigger')).toBeNull();
    expect(screen.queryByText(/^Search /)).toBeNull();
  });

  it('still lists channels', () => {
    seed();
    render(<Sidebar />);

    expect(screen.getByText('general')).toBeTruthy();
  });

  it('does not keep an account menu or utility buttons in the channel list', () => {
    seed();
    const { container } = render(<Sidebar />);

    expect(container.querySelector('.sidebar-footer')).toBeNull();
    expect(screen.queryByLabelText('Preferences')).toBeNull();
    expect(screen.queryByLabelText('Feedback')).toBeNull();
  });

  it('collapses to icons only', () => {
    seed();
    render(<Sidebar collapsed />);

    expect(screen.queryByText('general')).toBeNull();
    expect(screen.getByLabelText('general')).toBeTruthy();
  });
});
