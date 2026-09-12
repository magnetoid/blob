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
  it('carries the workspace mark and name, which the top bar no longer does', () => {
    // The reverse of what this asserted before. The name used to live in the top bar
    // and repeating it here would have been noise; the design moves identity to the top
    // of the channel list, and `TopBar` in the main shell is now passed `brand={false}`.
    seed();
    const { container } = render(<Sidebar />);

    expect(screen.getByText('Imba')).toBeTruthy();
    expect(container.querySelector('.workspace-mark')?.textContent).toBe('I');
  });

  it('keeps the mark when collapsed, since an initial is still an identity', () => {
    seed();
    const { container } = render(<Sidebar collapsed />);

    expect(container.querySelector('.workspace-mark')?.textContent).toBe('I');
    expect(screen.queryByText('Imba')).toBeNull();
  });

  it('offers a collapse control beside it', () => {
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

describe('agents have their own section', () => {
  const SCOUT = { id: 'b1', kind: 'bot', displayName: 'Scout', deactivated: false };

  function seedWithAgent(runs: Record<string, unknown> = {}) {
    useStore.setState({
      workspaceName: 'Imba',
      currentUser: { ...ME, role: 'owner' },
      users: { u1: ME, u2: MATE, b1: SCOUT },
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
      agentRuns: runs,
      savedMessageIds: new Set(),
    } as never);
  }

  it('lists an agent under Agents, not among the people', () => {
    seedWithAgent();
    render(<Sidebar />);

    const heading = screen.getByText('Agents');
    const section = heading.closest('section');
    expect(section?.textContent).toContain('Scout');
    expect(section?.textContent).not.toContain('Ana');
  });

  it('leaves the people where they were', () => {
    seedWithAgent();
    render(<Sidebar />);

    const section = screen.getByText('Direct messages').closest('section');
    expect(section?.textContent).toContain('Ana');
    expect(section?.textContent).not.toContain('Scout');
  });

  it('shows no Agents heading in a workspace that has none', () => {
    // A server with no model installs no built-in agent, and an empty shelf labelled
    // "Agents" would advertise a feature that is off.
    seed();
    render(<Sidebar />);

    expect(screen.queryByText('Agents')).toBeNull();
  });

  it('marks an agent that is mid-run', () => {
    seedWithAgent({
      r1: { id: 'r1', agentName: 'Scout', status: 'running' },
    });
    render(<Sidebar />);

    expect(screen.getByLabelText('Scout is working')).toBeTruthy();
  });

  it('leaves a finished agent unmarked', () => {
    seedWithAgent({
      r1: { id: 'r1', agentName: 'Scout', status: 'succeeded' },
    });
    render(<Sidebar />);

    expect(screen.queryByLabelText('Scout is working')).toBeNull();
  });
});
