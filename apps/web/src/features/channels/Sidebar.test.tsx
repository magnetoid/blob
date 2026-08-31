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
  it('names the workspace and how many people are in it', () => {
    seed();
    render(<Sidebar />);

    expect(screen.getByText('Imba')).toBeTruthy();
    // The only place the conversation view says how large the workspace is.
    expect(screen.getByText('2 members')).toBeTruthy();
  });

  it('has no menu behind the workspace name', () => {
    // Both of its rows were reachable twice over from the bar, and its
    // Administration row pointed at the owner-gated instance console while
    // showing itself to any admin.
    seed();
    const { container } = render(<Sidebar />);

    expect(container.querySelector('.workspace-trigger')).toBeNull();
    expect(container.querySelector('.workspace-menu')).toBeNull();
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
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
});
