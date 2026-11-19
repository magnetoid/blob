// @vitest-environment happy-dom
/**
 * The channel list, as shadcn's Sidebar: rows are its menu buttons, groups its groups, and
 * folding it is its rail. Read by role, label and the data attributes the rows carry, not by
 * class — the classes are Tailwind's now, and a test that read them would pin the styling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '../../components/ui/sidebar.tsx';
import { Sidebar } from './Sidebar.tsx';
import { ChannelMenu } from './lazyMenus.ts';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

// The sidebar reads the path to light the row you are on and navigates when one is chosen;
// where it goes is what these tests ask, not how the router gets there.
const route = vi.hoisted(() => ({ path: '/' }));
vi.mock('../../lib/router.ts', async (original) => ({
  ...(await original<typeof import('../../lib/router.ts')>()),
  navigate: vi.fn(),
  usePath: () => route.path,
}));

const { navigate } = await import('../../lib/router.ts');

// The channel menu is its own lazy module (`lazyMenus.ts`). Loaded while the file is
// collected, as `test/overlayChunk.ts` loads the overlay chunk, so a first press does not
// pay for a cold import that a busy machine can stretch past `findBy`'s second.
await ChannelMenu.preload();

beforeEach(() => {
  route.path = '/';
  vi.mocked(navigate).mockClear();
});

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
    activeCalls: {},
    agentRuns: {},
    drafts: {},
    savedMessageIds: new Set(),
  } as never);
}

/** The list as the shell draws it: inside the sidebar's provider, open or folded to its rail. */
function draw({ folded = false }: { folded?: boolean } = {}) {
  return render(
    <SidebarProvider defaultOpen={!folded}>
      <Sidebar />
    </SidebarProvider>,
  );
}

/** A row's button, by the name a screen reader reads for it. */
const row = (name: string | RegExp) => screen.getByRole('button', { name });

/** The menu item a row's button stands in: where its badge, its live dot and its options are. */
const itemOf = (name: string | RegExp) => row(name).closest<HTMLElement>('[data-slot="sidebar-menu-item"]')!;

describe('the sidebar header', () => {
  it('draws no identity of its own beside the view — the top bar carries it', () => {
    // This has now swung both ways, so it is worth saying why rather than just which:
    // the bar spans the channel list *and* the conversation, this column spans only the
    // list, and the workspace names the whole app. What the test is really pinning is
    // that exactly one surface draws the name — two copies a few centimetres apart is
    // the defect either arrangement can produce. (On a phone the Sheet covers the bar,
    // so there the Sheet draws it: `app/Workspace.shell.test.tsx`.)
    seed();
    draw();

    expect(screen.queryByText('Imba')).toBeNull();
    expect(screen.queryByText('I')).toBeNull();
  });

  it('draws none when folded either', () => {
    seed();
    draw({ folded: true });

    expect(screen.queryByText('Imba')).toBeNull();
    expect(screen.queryByText('I')).toBeNull();
  });

  it('has no search button, because the bar and ⌘F already have one', () => {
    seed();
    draw();

    expect(screen.queryByRole('button', { name: /^Search/ })).toBeNull();
    expect(screen.queryByText(/^Search /)).toBeNull();
  });

  it('still lists channels', () => {
    seed();
    draw();

    expect(screen.getByText('general')).toBeTruthy();
  });

  it('does not keep an account menu or utility buttons in the channel list', () => {
    seed();
    const { container } = draw();

    expect(container.querySelector('[data-slot="sidebar-footer"]')).toBeNull();
    expect(screen.queryByLabelText('Preferences')).toBeNull();
    expect(screen.queryByLabelText('Feedback')).toBeNull();
  });

  it('names the list as a navigation landmark', () => {
    seed();
    draw();

    const nav = screen.getByRole('navigation', { name: 'Channel list' });
    expect(nav.contains(row('general'))).toBe(true);
    expect(nav.contains(row('Home'))).toBe(true);
  });
});

describe('the places in the workspace', () => {
  const PLACES = ['Home', 'Activity', 'Mentions', 'Threads', 'Tasks', 'Decisions', 'Later', 'Files', 'Scheduled'];

  /** The nav group's rows, in the order they are drawn. */
  const places = () =>
    within(row('Home').closest<HTMLElement>('[data-slot="sidebar-menu"]')!)
      .getAllByRole('button')
      .map((button) => button.textContent);

  it('lists the places in order, the tabs’ two among them', () => {
    seed();
    draw();

    expect(places()).toEqual(PLACES);
  });

  it('adds Drafts at the end while something is unsent', () => {
    seed();
    useStore.setState({ drafts: { c1: { body: 'half a thought' } } } as never);
    draw();

    expect(places()).toEqual([...PLACES, 'Drafts']);
  });

  it('links Activity and Files, and lights Activity for /activity, Mentions for /mentions, Files for /files', () => {
    seed();
    route.path = '/activity';
    const { unmount } = draw();
    expect(row('Activity').getAttribute('aria-current')).toBe('page');
    expect(row('Mentions').hasAttribute('aria-current')).toBe(false);

    fireEvent.click(row('Activity'));
    expect(navigate).toHaveBeenLastCalledWith('/activity');
    fireEvent.click(row('Files'));
    expect(navigate).toHaveBeenLastCalledWith('/files');
    fireEvent.click(row('Mentions'));
    expect(navigate).toHaveBeenLastCalledWith('/mentions');
    unmount();

    route.path = '/mentions';
    const mentions = draw();
    expect(row('Mentions').getAttribute('aria-current')).toBe('page');
    expect(row('Activity').hasAttribute('aria-current')).toBe(false);
    mentions.unmount();

    route.path = '/files';
    const files = draw();
    expect(row('Files').getAttribute('aria-current')).toBe('page');
    expect(row('Activity').hasAttribute('aria-current')).toBe(false);
    files.unmount();

    // A conversation's own files are the Files page too, filtered.
    route.path = '/files?channel=c1';
    draw();
    expect(row('Files').getAttribute('aria-current')).toBe('page');
  });

  it('lights Browse on the channel directory', () => {
    seed();
    route.path = '/channels';
    draw();

    expect(row(/^Browse/).getAttribute('aria-current')).toBe('page');
    expect(row('Home').hasAttribute('aria-current')).toBe(false);
  });

  it('draws Tasks with the task icon', () => {
    seed();
    draw();

    // Lucide's ListTodo: a list of things to do, where Files keeps the sheet of paper.
    expect(row('Tasks').querySelector('svg.lucide-list-todo')).not.toBeNull();
    expect(row('Files').querySelector('svg.lucide-file')).not.toBeNull();
    expect(row('Activity').querySelector('svg.lucide-bell')).not.toBeNull();
  });
});

describe('folded to its rail', () => {
  const SCOUT = { id: 'b1', kind: 'bot', displayName: 'Scout', deactivated: false };

  it('draws icons only, and every row keeps its name', () => {
    seed();
    draw({ folded: true });

    expect(screen.queryByText('general')).toBeNull();
    expect(row('general')).toBeTruthy();
    expect(row('Home')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Channels' })).toBeNull();
  });

  it('still marks the row you are on', () => {
    seed();
    route.path = '/later';
    draw({ folded: true });

    expect(row('Later').getAttribute('aria-current')).toBe('page');
  });

  it('keeps New direct message and All agents reachable when folded', () => {
    seed();
    useStore.setState((s) => ({ users: { ...s.users, b1: SCOUT } }) as never);
    draw({ folded: true });

    fireEvent.click(row('All agents'));
    expect(navigate).toHaveBeenLastCalledWith('/agents');

    // The same dialog the open list's "New message" opens.
    expect(row('New direct message')).toBeTruthy();
  });

  it('keeps a channel’s mention badge on the rail', () => {
    seed();
    useStore.setState((s) => ({
      channels: { c1: { ...s.channels.c1!, mentionCount: 2 } },
    }) as never);
    draw({ folded: true });

    expect(itemOf('general').querySelector('[data-slot="sidebar-menu-badge"]')?.textContent).toBe('2');
  });

  it('names a private channel as private, which is all its lock says there', () => {
    seed();
    useStore.setState((s) => ({
      channels: {
        ...s.channels,
        c2: {
          id: 'c2',
          kind: 'private',
          name: 'leads',
          membership: { isStarred: false },
          archivedAt: null,
          memberIds: ['u1'],
        },
      },
    }) as never);
    draw({ folded: true });

    // The same words the open row's hidden ", private" adds, and the tooltip says them too.
    const leads = row('leads, private');
    expect(leads.getAttribute('title')).toBe('leads, private');
    // A public one is its bare name.
    expect(row('general').getAttribute('aria-label')).toBe('general');
  });

  it('gives every row a tooltip, since none of them shows its name', () => {
    seed();
    draw({ folded: true });

    expect(row('Home').getAttribute('title')).toBe('Home');
    expect(row('general').getAttribute('title')).toBe('general');
    expect(row('Ana').getAttribute('title')).toBe('Ana');
    expect(row('New channel').getAttribute('title')).toBe('New channel');
  });

  it('keeps a channel’s options reachable on the rail, by pointer and by keyboard', async () => {
    seed();
    draw({ folded: true });

    // A real button after the row's own in the tab order, drawn in the square's corner:
    // shown on hover and on focus, as beside a name.
    const options = screen.getByRole('button', { name: 'Options for general' });
    expect(options.className).toContain('group-data-[collapsible=icon]:flex');
    expect(options.getAttribute('aria-haspopup')).toBe('menu');
    options.focus();
    fireEvent.click(options);
    expect(await screen.findByRole('menuitem', { name: 'Star this channel' })).toBeTruthy();
  });
});

describe('a row open beside the view', () => {
  it('has no tooltip repeating the name it shows', () => {
    seed();
    draw();

    // A person's row is read with their avatar's initial before the name.
    for (const name of ['Home', 'Activity', 'general', /Ana$/, 'New channel']) {
      expect(row(name).hasAttribute('title'), String(name)).toBe(false);
    }
  });

  it('keeps a person’s tooltip while it says their status, which the row does not show', () => {
    seed();
    useStore.setState((s) => ({
      users: { ...s.users, u2: { ...MATE, statusText: 'On a train' } },
    }) as never);
    draw();

    expect(row(/Ana$/).getAttribute('title')).toBe('Ana — On a train');
  });
});

describe('agents have their own section', () => {
  const SCOUT = { id: 'b1', kind: 'bot', displayName: 'Scout', deactivated: false };

  function seedWithAgent(runs: Record<string, unknown> = {}) {
    seed();
    useStore.setState({
      users: { u1: ME, u2: MATE, b1: SCOUT },
      agentRuns: runs,
    } as never);
  }

  /** The group a heading names. */
  const groupOf = (heading: string) =>
    screen.getByRole('heading', { name: heading }).closest<HTMLElement>('[data-slot="sidebar-group"]')!;

  it('leaves out an agent whose app is switched off', () => {
    // Uninstalled and disabled are different states — one is retirement, the other an
    // admin toggle — but the reader's question is the same, and the answer is the same:
    // nothing will answer you. An admin re-enables it in Administration.
    seed();
    useStore.setState({
      users: {
        u1: ME,
        b1: SCOUT,
        b2: { id: 'b2', kind: 'bot', displayName: 'Rusty', deactivated: false, agentDisabled: true, agentResident: false },
        b3: { id: 'b3', kind: 'bot', displayName: 'Gone', deactivated: true },
      },
      channels: {},
    } as never);
    draw();

    const section = groupOf('Agents');
    expect(section.textContent).toContain('Scout');
    expect(section.textContent).not.toContain('Rusty');
    expect(section.textContent).not.toContain('Gone');
  });

  it('lists an agent under Agents, not among the people', () => {
    seedWithAgent();
    draw();

    const section = groupOf('Agents');
    expect(section.textContent).toContain('Scout');
    expect(section.textContent).not.toContain('Ana');
    // All agents is the group's own action while the list is open.
    fireEvent.click(within(section).getByRole('button', { name: 'All agents' }));
    expect(navigate).toHaveBeenLastCalledWith('/agents');
  });

  it('leaves the people where they were', () => {
    seedWithAgent();
    draw();

    const section = groupOf('Direct messages');
    expect(section.textContent).toContain('Ana');
    expect(section.textContent).not.toContain('Scout');
    expect(within(section).getByRole('button', { name: 'New message' })).toBeTruthy();
  });

  it('shows no Agents heading in a workspace that has none', () => {
    // A server with no model installs no built-in agent, and an empty shelf labelled
    // "Agents" would advertise a feature that is off.
    seed();
    draw();

    expect(screen.queryByText('Agents')).toBeNull();
  });

  it('marks an agent that is mid-run', () => {
    seedWithAgent({
      r1: { id: 'r1', agentName: 'Scout', status: 'running' },
    });
    draw();

    expect(screen.getByRole('status', { name: 'Scout is working' })).toBeTruthy();
  });

  it('leaves a finished agent unmarked', () => {
    seedWithAgent({
      r1: { id: 'r1', agentName: 'Scout', status: 'succeeded' },
    });
    draw();

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
    seed();
    useStore.setState((s) => ({
      channels: { c1: { ...s.channels.c1!, mentionCount } },
      // Enough saved messages to put a badge on "Later" as well, which is the point: an
      // unscoped query for a badge reads Later's first, and these tests would pass on the
      // wrong number.
      savedMessageIds: new Set(['m1', 'm2']),
    }) as never);
  }

  /** The channel's own badge, beside its row in the row's menu item. */
  const channelBadge = () => itemOf('general').querySelector('[data-slot="sidebar-menu-badge"]')!;

  it('is replaced when the count changes', () => {
    seedWithMentions(3);
    draw();
    const before = channelBadge();
    expect(before.textContent).toBe('3');
    expect(itemOf('Later').querySelector('[data-slot="sidebar-menu-badge"]')?.textContent).toBe('2');

    act(() => seedWithMentions(4));

    const after = channelBadge();
    expect(after.textContent).toBe('4');
    expect(after).not.toBe(before);
  });

  it('is the same node when the count has not changed', () => {
    // Otherwise every unrelated store update would pop a number nobody touched.
    seedWithMentions(3);
    draw();
    const before = channelBadge();

    act(() => seedWithMentions(3));

    expect(channelBadge()).toBe(before);
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

  it('leaves the rows it was drawn with still', () => {
    seed();
    draw();
    expect(itemOf('general').dataset.arriving).toBeUndefined();
  });

  it('slides in a row that arrives later, once', () => {
    seed();
    draw();

    act(() => {
      useStore.setState((s) => ({ channels: { ...s.channels, c2: RANDOM } }) as never);
    });
    const arrived = itemOf('random');
    expect(arrived.dataset.arriving).toBe('true');
    expect(itemOf('general').dataset.arriving).toBeUndefined();

    // Its entrance ends, and it is one of the list from then on.
    act(() => {
      arrived.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(itemOf('random').dataset.arriving).toBeUndefined();
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
    draw();
    expect(screen.getByRole('img', { name: 'A huddle is on' })).toBeTruthy();
  });
});

describe('a channel row', () => {
  it('has its options beside it, named for the channel', () => {
    seed();
    draw();

    const options = within(itemOf('general')).getByRole('button', { name: 'Options for general' });
    expect(options.getAttribute('aria-haspopup')).toBe('menu');
    expect(options.getAttribute('aria-expanded')).toBe('false');
  });

  it('says it is unread, and the one you are in says it is current instead', () => {
    seed();
    useStore.setState((s) => ({
      channels: { c1: { ...s.channels.c1!, hasUnread: true } },
      activeChannelId: null,
    }) as never);
    const { unmount } = draw();
    expect(row('general').dataset.unread).toBe('true');
    expect(row('general').hasAttribute('aria-current')).toBe(false);
    unmount();

    useStore.setState({ activeChannelId: 'c1' } as never);
    draw();
    expect(row('general').dataset.unread).toBeUndefined();
    expect(row('general').getAttribute('aria-current')).toBe('page');
  });
});

describe('for a guest (ADR 0034)', () => {
  it('offers nothing to browse and nowhere new to start', () => {
    seed();
    useStore.setState({ currentUser: { ...ME, role: 'guest' } } as never);
    draw();

    expect(screen.getByText('general')).toBeTruthy();
    expect(screen.queryByText(/^Browse/)).toBeNull();
    expect(screen.queryByText('New channel')).toBeNull();
  });

  it('while a member keeps both', () => {
    seed();
    useStore.setState({ currentUser: { ...ME, role: 'member' } } as never);
    draw();

    expect(screen.getByText(/^Browse/)).toBeTruthy();
    expect(screen.getByText('New channel')).toBeTruthy();
  });
});

describe('a private channel in the list', () => {
  it('wears a lock, and says it is private to a screen reader', () => {
    seed();
    useStore.setState({
      channels: {
        ...useStore.getState().channels,
        c2: {
          id: 'c2',
          kind: 'private',
          name: 'leads',
          membership: { isStarred: false },
          archivedAt: null,
          memberIds: ['u1'],
        },
      },
    } as never);
    const { container } = draw();

    const leads = row(/^leads/);
    expect(leads.textContent).toContain('leads, private');
    expect(leads.querySelector('[data-mark="private"] svg')).toBeTruthy();
    expect(leads.querySelector('[data-mark="private"]')?.textContent).toBe('');
    const general = row(/^general/);
    expect(general.querySelector('[data-mark="public"]')?.textContent).toBe('#');
    expect(container.querySelectorAll('[data-mark="private"]')).toHaveLength(1);
  });
});
