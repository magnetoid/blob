// @vitest-environment happy-dom
/**
 * The chat shell: the top bar, the channel list and the view beside it, on shadcn's
 * SidebarProvider. What these pin is the shell's part — that the list is a Sheet on a
 * phone and a column that folds to a rail at a desk, that the fold is remembered, that
 * Escape with the Sheet open closes the Sheet and nothing behind it, and that the views
 * stay the shell's own panes, where the legacy CSS still reaches them.
 *
 * The views are stand-ins, each a `main.pane` as the real ones are: what they draw is
 * their own tests' business, and the real ones would bring the whole app in with them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// Below 768px the list is a Sheet, which comes from the overlay chunk: here before the first
// case, so opening it is not a second of the chunk's evaluation inside a `findByRole`.
import '../test/overlayChunk.ts';

vi.mock('../lib/socket.ts', () => ({ socket: { sendControl: vi.fn() } }));
vi.mock('../features/shell/WorkspaceSwitcher.tsx', () => ({
  WorkspaceSwitcher: ({ name }: { name: string }) => <div>{name}</div>,
}));
vi.mock('../features/home/HomeView.tsx', () => ({ HomeView: () => <main className="pane">Home page</main> }));
vi.mock('../features/messages/ChannelView.tsx', () => ({
  ChannelView: () => <main className="pane">The conversation</main>,
}));
vi.mock('../features/messages/ThreadsView.tsx', () => ({
  ThreadsView: () => <main className="pane">Threads page</main>,
}));
vi.mock('../features/messages/ActivityView.tsx', () => ({
  ActivityView: () => <main className="pane">Activity page</main>,
}));
vi.mock('../features/messages/ThreadPanel.tsx', () => ({
  ThreadPanelSlot: ({ rootId }: { rootId: string | null }) =>
    rootId ? <aside className="panel" aria-label="Thread">The thread</aside> : null,
}));
vi.mock('../features/messages/ImageLightbox.tsx', () => ({ ImageLightbox: () => null }));
vi.mock('../features/agentic/TasksView.tsx', () => ({ TasksView: () => <main className="pane" /> }));
vi.mock('../features/agentic/AgentsView.tsx', () => ({ AgentsView: () => <main className="pane" /> }));
vi.mock('../features/decisions/DecisionsView.tsx', () => ({ DecisionsView: () => <main className="pane" /> }));
vi.mock('../features/messages/SavedView.tsx', () => ({ SavedView: () => <main className="pane" /> }));
vi.mock('../features/messages/FilesView.tsx', () => ({ FilesView: () => <main className="pane" /> }));
vi.mock('../features/settings/WhatsNewView.tsx', () => ({ WhatsNewView: () => <main className="pane" /> }));
vi.mock('../features/channels/BrowseChannels.tsx', () => ({ BrowseChannels: () => <main className="pane" /> }));
vi.mock('../features/messages/ScheduledView.tsx', () => ({ ScheduledView: () => <main className="pane" /> }));
vi.mock('../features/messages/DraftsView.tsx', () => ({ DraftsView: () => <main className="pane" /> }));
vi.mock('../features/search/SearchView.tsx', () => ({ SearchView: () => <main className="pane" /> }));
vi.mock('../features/agentic/AgentTerminalPanel.tsx', () => ({ AgentTerminalPanel: () => null }));
vi.mock('../features/messages/FilePreviewPanel.tsx', () => ({ FilePreviewPanel: () => null }));
vi.mock('../features/palette/CommandPalette.tsx', () => ({ CommandPalette: () => null }));
vi.mock('../features/messages/CatchUpPanel.tsx', () => ({ CatchUpPanel: () => null }));
vi.mock('../features/feedback/FeedbackDialog.tsx', () => ({ FeedbackDialog: () => null }));
vi.mock('../components/ShortcutHelp.tsx', () => ({ ShortcutHelp: () => null }));

const { Workspace } = await import('./Workspace.tsx');
const { useStore } = await import('../lib/store.ts');

const ME = { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false };
const openChannel = vi.fn(async () => undefined);
const openThread = vi.fn(async () => undefined);
const markRead = vi.fn(async () => undefined);

/** Signed in, in #general with a thread open beside it — the URL says the same. */
function seed({ thread = true }: { thread?: boolean } = {}) {
  useStore.setState({
    workspaceName: 'Imba',
    currentUser: { ...ME, role: 'member' },
    users: { u1: ME },
    channels: {
      c1: {
        id: 'c1',
        kind: 'public',
        name: 'general',
        membership: { isStarred: false, notifyLevel: 'all' },
        archivedAt: null,
        memberIds: ['u1'],
        hasUnread: true,
        mentionCount: 0,
      },
    },
    presence: {},
    activeCalls: {},
    agentRuns: {},
    drafts: {},
    savedMessageIds: new Set(),
    activeChannelId: 'c1',
    activeThreadRootId: thread ? 'r1' : null,
    terminalTarget: null,
    filePreview: null,
    catchupScope: null,
    lightbox: null,
    callEngineLoaded: false,
    callSession: null,
    pendingCallSwitch: false,
    openChannel,
    openThread,
    markRead,
    loadCalls: vi.fn(async () => undefined),
    syncDrafts: vi.fn(async () => undefined),
  } as never);
  window.history.replaceState({}, '', thread ? '/c/c1/t/r1' : '/c/c1');
}

/** A phone, or a desk: the sidebar's breakpoint is read from the media query. */
function viewport(width: 'phone' | 'desk') {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: width === 'phone' && query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

beforeEach(() => {
  openChannel.mockClear();
  openThread.mockClear();
  markRead.mockClear();
  window.localStorage.removeItem('blob.sidebar.collapsed');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('the channel list on a phone', () => {
  it('opens the channel list as a Sheet and closes it when a row is chosen', async () => {
    viewport('phone');
    seed({ thread: false });
    const { container } = render(<Workspace onSignedOut={vi.fn()} />);

    // Shut, the list is not in the page at all: no column in the shell, no drawer behind
    // a transform, so its rows are not in the tab order.
    expect(container.querySelector('.shell > [data-slot="sidebar"]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Channel list' })).toBeNull();

    const trigger = screen.getByRole('button', { name: 'Open channel list' });
    fireEvent.click(trigger);

    const sheet = await screen.findByRole('dialog', { name: 'Channel list' });
    const nav = within(sheet).getByRole('navigation', { name: 'Channel list' });
    // The Sheet is named twice over: its close button says which list it closes.
    expect(within(sheet).getByRole('button', { name: 'Close channel list' })).toBeTruthy();
    // It covers the top bar, so it says whose workspace this is itself — in a header above
    // the first row, which is the row the close button used to sit on.
    const name = within(sheet).getByText('Imba');
    expect(nav.contains(name)).toBe(false);
    const home = within(nav).getByRole('button', { name: 'Home' });
    expect(name.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.closest('[data-slot="sidebar-header"]')).not.toBeNull();

    fireEvent.click(within(nav).getByRole('button', { name: 'Threads' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/threads');
    expect(screen.getByText('Threads page')).toBeTruthy();
    // Focus is back on the button that opened the list, not dropped on <body>.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes only the Sheet on Escape, leaving the thread open and the channel unread', async () => {
    viewport('phone');
    seed();
    render(<Workspace onSignedOut={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: 'Thread' })).toBeTruthy();

    const trigger = screen.getByRole('button', { name: 'Open channel list' });
    fireEvent.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'Channel list' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    // One Escape, one layer: the thread behind the Sheet is still open, and nothing took
    // the key as Slack's "this channel is read".
    expect(openThread).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: 'Thread' })).toBeTruthy();

    // The next one is the thread's.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(openThread).toHaveBeenCalledWith(null);
    expect(markRead).not.toHaveBeenCalled();
  });
});

describe('the channel list at a desk', () => {
  it('folds to the rail and remembers it in blob.sidebar.collapsed', () => {
    viewport('desk');
    seed({ thread: false });
    const { container, unmount } = render(<Workspace onSignedOut={vi.fn()} />);
    const list = () => container.querySelector<HTMLElement>('.shell > [data-slot="sidebar"]')!;
    expect(list().dataset.state).toBe('expanded');

    fireEvent.click(screen.getByRole('button', { name: 'Hide channel list' }));

    expect(list().dataset.state).toBe('collapsed');
    expect(list().dataset.collapsible).toBe('icon');
    expect(window.localStorage.getItem('blob.sidebar.collapsed')).toBe('true');
    // Folded, every row is still there by name.
    expect(screen.getByRole('button', { name: 'general' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show channel list' })).toBeTruthy();

    // A reload comes back folded.
    unmount();
    const again = render(<Workspace onSignedOut={vi.fn()} />);
    expect(again.container.querySelector<HTMLElement>('.shell > [data-slot="sidebar"]')?.dataset.state).toBe(
      'collapsed',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show channel list' }));
    expect(again.container.querySelector<HTMLElement>('.shell > [data-slot="sidebar"]')?.dataset.state).toBe(
      'expanded',
    );
    expect(window.localStorage.getItem('blob.sidebar.collapsed')).toBe('false');
  });

  it('draws every view as a pane of the shell, outside every shadcn component', () => {
    // The shell's root is the sidebar's provider, and a shadcn component's `data-slot` is
    // what keeps the preflight repair (styles/app/base.css) away from what is inside it.
    // The views are legacy markup, so the root must not carry one — and the frame's rules
    // (`.shell > .pane`, `.shell > .panel`) need them as the shell's own children.
    viewport('desk');
    seed();
    const { container } = render(<Workspace onSignedOut={vi.fn()} />);

    const shell = container.querySelector<HTMLElement>('.shell')!;
    expect(shell.hasAttribute('data-slot')).toBe(false);
    expect(shell.dataset.panel).toBe('open');

    const pane = screen.getByRole('main');
    expect(pane.classList.contains('pane')).toBe(true);
    expect(pane.parentElement).toBe(shell);
    expect(pane.closest('[data-slot]')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Thread' }).parentElement).toBe(shell);
    expect(screen.getByRole('banner').closest('[data-slot]')).toBeNull();

    // The list is a column of the same grid, and the only shadcn component in it.
    expect(shell.querySelector(':scope > [data-slot="sidebar"]')).not.toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
