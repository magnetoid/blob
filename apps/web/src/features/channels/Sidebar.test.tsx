// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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
  it('draws no identity of its own — the top bar carries it', () => {
    // This has now swung both ways, so it is worth saying why rather than just which:
    // the bar spans the channel list *and* the conversation, this column spans only the
    // list, and the workspace names the whole app. What the test is really pinning is
    // that exactly one surface draws the name — two copies a few centimetres apart is
    // the defect either arrangement can produce.
    seed();
    const { container } = render(<Sidebar />);

    expect(container.querySelector('.workspace-mark')).toBeNull();
    expect(screen.queryByText('Imba')).toBeNull();
  });

  it('draws none when collapsed either', () => {
    seed();
    const { container } = render(<Sidebar collapsed />);

    expect(container.querySelector('.workspace-mark')).toBeNull();
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

  it('leaves out an agent whose app is switched off', () => {
    // Uninstalled and disabled are different states — one is retirement, the other an
    // admin toggle — but the reader's question is the same, and the answer is the same:
    // nothing will answer you. An admin re-enables it in Administration.
    useStore.setState({
      workspaceName: 'Imba',
      currentUser: { ...ME, role: 'owner' },
      users: {
        u1: ME,
        b1: SCOUT,
        b2: { id: 'b2', kind: 'bot', displayName: 'Rusty', deactivated: false, agentDisabled: true, agentResident: false },
        b3: { id: 'b3', kind: 'bot', displayName: 'Gone', deactivated: true },
      },
      channels: {},
      presence: {},
      agentRuns: {},
      savedMessageIds: new Set(),
    } as never);
    render(<Sidebar />);

    const section = screen.getByText('Agents').closest('section');
    expect(section?.textContent).toContain('Scout');
    expect(section?.textContent).not.toContain('Rusty');
    expect(section?.textContent).not.toContain('Gone');
  });

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

/**
 * A mention arriving in a channel you are not looking at moves one digit in the left
 * column, and that was the entire tell. The badge is keyed by its own count, so React
 * replaces the node when the number moves and the replacement plays `badge-pop` — the
 * remount is the mechanism, so node identity is what a test can hold onto.
 */
describe('the unread mention badge', () => {
  function seedWithMentions(mentionCount: number) {
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
          mentionCount,
        },
      },
      presence: {},
      // Enough saved messages to put a badge on "Later" as well, which is the point:
      // the nav badge is the first `.badge` in the sidebar, so an unscoped query reads
      // it instead of the channel's and these tests would pass on the wrong number.
      savedMessageIds: new Set(['m1', 'm2']),
    } as never);
  }

  /** The channel's own badge. `.channel-row` will not do — the nav buttons carry that
   *  class too — so the wrapper only a channel row has is what separates them. */
  const channelBadge = (container: HTMLElement) =>
    container.querySelector('.channel-row-wrap .badge')!;

  it('is replaced when the count changes', () => {
    seedWithMentions(3);
    const { container } = render(<Sidebar />);
    const before = channelBadge(container);
    expect(before.textContent).toBe('3');

    act(() => seedWithMentions(4));

    const after = channelBadge(container);
    expect(after.textContent).toBe('4');
    expect(after).not.toBe(before);
  });

  it('is the same node when the count has not changed', () => {
    // Otherwise every unrelated store update would pop a number nobody touched.
    seedWithMentions(3);
    const { container } = render(<Sidebar />);
    const before = channelBadge(container);

    act(() => seedWithMentions(3));

    expect(channelBadge(container)).toBe(before);
  });
});

/**
 * A conversation that joins the list while you watch slides in; the list you arrive to
 * does not. The rows are all "new" to a sidebar that has just mounted — at start-up, and
 * again coming back from the console — so the rule is what was there on the first render.
 */
describe('a conversation joining the list', () => {
  const RANDOM = {
    id: 'c2',
    kind: 'public',
    name: 'random',
    membership: { isStarred: false },
    archivedAt: null,
    memberIds: ['u1'],
  };

  const wrapOf = (container: HTMLElement, name: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('.channel-row-wrap')).find((wrap) =>
      wrap.textContent?.includes(name),
    )!;

  it('leaves the rows it was drawn with still', () => {
    seed();
    const { container } = render(<Sidebar />);
    expect(wrapOf(container, 'general').dataset.arriving).toBeUndefined();
  });

  it('slides in a row that arrives later, once', () => {
    seed();
    const { container } = render(<Sidebar />);

    act(() => {
      useStore.setState((s) => ({ channels: { ...s.channels, c2: RANDOM } }) as never);
    });
    const arrived = wrapOf(container, 'random');
    expect(arrived.dataset.arriving).toBe('true');
    expect(wrapOf(container, 'general').dataset.arriving).toBeUndefined();

    // Its entrance ends, and it is one of the list from then on.
    act(() => {
      arrived.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(wrapOf(container, 'random').dataset.arriving).toBeUndefined();
  });
});

/**
 * A call live in a conversation is a fact about that row, the same as an unread mention
 * or an unsent draft — worth seeing without opening it.
 */
describe('a live call marks its conversation', () => {
  it('marks a conversation with a live call', () => {
    seed();
    useStore.setState({
      activeCalls: {
        c1: {
          id: 'c1', channelId: 'c1', kind: 'huddle', createdBy: 'u1', status: 'active',
          createdAt: '', endedAt: null, participantIds: ['u1'],
        },
      },
    });
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole('img', { name: 'A huddle is on' })).toBeTruthy();
  });
});
