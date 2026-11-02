// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Sidebar, SidebarProvider, SidebarTrigger } from '../../components/ui/sidebar.tsx';
import { ConsoleNav } from './ConsoleNav.tsx';
import { ADMIN_NAV, SERVER_NAV, SETTINGS_NAV, type NavGroup, type Viewer } from './registry.ts';

// vitest globals are off, so RTL's automatic cleanup never runs. Without this, one
// test's markup is still in the document while the next one queries it.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADMIN: Viewer = { role: 'admin', isInstanceAdmin: false };
const OWNER: Viewer = { role: 'owner', isInstanceAdmin: false };
const FOUNDER: Viewer = { role: 'owner', isInstanceAdmin: true };


/** A small catalogue with one row behind each gate, and one newly shipped. */
const GATED: NavGroup[] = [
  {
    id: 'rows',
    sections: [
      { id: 'members', label: 'Members', keywords: ['roles'] },
      { id: 'invitations', label: 'Invitations', badge: 'new' },
      { id: 'transfer', label: 'Transfer ownership', access: 'owner' },
      { id: 'logs', label: 'Errors and logs', access: 'instance' },
    ],
  },
];

/** The nav lives inside the sidebar's provider, which is where it closes the sheet from. */
function inSidebar({ children }: { children: ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}

function renderNav(groups: NavGroup[], viewer: Viewer, section: string, basePath?: string) {
  return render(
    <ConsoleNav groups={groups} section={section} viewer={viewer} basePath={basePath} />,
    { wrapper: inSidebar },
  );
}

function renderAdminNav(viewer: Viewer = FOUNDER, section = 'general') {
  return renderNav(ADMIN_NAV, viewer, section);
}

/** The server console's nav as ServerConsole hands it over: rows at its own level go unbadged. */
function renderServerNav(viewer: Viewer = FOUNDER, section = 'health') {
  return render(
    <ConsoleNav
      groups={SERVER_NAV}
      section={section}
      viewer={viewer}
      basePath="/server"
      baseAccess="instance"
    />,
    { wrapper: inSidebar },
  );
}

/** The rows the nav draws, by label, in order: one button to a list item. */
function rowLabels(): string[] {
  return screen
    .queryAllByRole('listitem')
    .map((item) => within(item).getByRole('button').textContent ?? '');
}

const WORKSPACE_ROWS = [
  'General',
  'Appearance',
  'People',
  'Channels',
  'Emoji',
  'Calls',
  'Feedback',
  'Apps & agents',
  'Janus',
  'MCP servers',
  'Usage',
  'Approvals',
  'Webhooks',
  'Deliveries',
  'Assistants',
  'Export',
  'Import',
  'Retention',
  'Security',
  'Audit log',
];

describe('the workspace console’s nav', () => {
  it('is three groups under their headings, in the registry’s order', () => {
    const { container } = renderAdminNav();
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Workspace',
      'Apps & agents',
      'Data & security',
    ]);
    expect(container.querySelector('.section-note')).toBeNull();
    expect(rowLabels()).toEqual(WORKSPACE_ROWS);
  });

  it('draws nothing that is not a page', () => {
    renderAdminNav();
    expect(screen.queryByText('Soon')).toBeNull();
    // Approvals was one of these, until it became a page that opens (M4).
    for (const gone of ['Moderation', 'Import / export']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByText('Only you can see these.')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });

  // The machine's pages are the server console's now: nothing here is anybody's but a
  // workspace admin's, so nothing here is badged, whoever is looking.
  it('shows every admin the same rows, with no badge on any', () => {
    for (const viewer of [ADMIN, OWNER, FOUNDER]) {
      const { unmount } = renderAdminNav(viewer);
      expect(rowLabels()).toEqual(WORKSPACE_ROWS);
      expect(screen.queryByText('Server')).toBeNull();
      for (const moved of ['Health', 'Accounts', 'Single sign-on', 'App policy', 'Errors and logs']) {
        expect(screen.queryByText(moved)).toBeNull();
      }
      unmount();
    }
  });

  it('narrows the list to what was typed, dropping a heading left with no rows', () => {
    renderAdminNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'log' } });
    expect(rowLabels()).toEqual(['Audit log']);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Data & security',
    ]);

    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: '' } });
    expect(rowLabels()).toHaveLength(WORKSPACE_ROWS.length);
  });

  // The heading is a word people search by: "data" finds the rows under it.
  it('finds a row by the heading it sits under', () => {
    renderAdminNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'data' } });
    expect(rowLabels()).toEqual(['Export', 'Import', 'Retention', 'Security', 'Audit log']);
  });
});

describe('the server console’s nav', () => {
  it('is one list with no headings, in the registry’s order', () => {
    renderServerNav();
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(rowLabels()).toEqual([
      'Health',
      'Storage',
      'Accounts',
      'Single sign-on',
      'App policy',
      'Errors and logs',
    ]);
  });

  // Every row here is the server admin's: badging each "Server" would say nothing.
  it('badges nothing, since everybody here passes the gate on every row', () => {
    renderServerNav();
    expect(screen.queryByText('Server')).toBeNull();
  });

  it('offers a workspace admin who does not run the server only what any admin may open', () => {
    renderServerNav(ADMIN);
    expect(rowLabels()).toEqual(['Health', 'Storage']);
  });
});

// Settings is not part of the change, and shares this component: its heading and its
// rows have to come out exactly as they did.
describe('the settings nav', () => {
  it('keeps its heading over its four rows, with nothing else on them', () => {
    renderNav(SETTINGS_NAV, ADMIN, 'preferences', '/settings');
    const headings = screen.getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual(['You']);
    expect(headings[0]?.tagName).toBe('H2');

    // The heading opens its group, and the group's rows are the ones under it.
    const group = headings[0]!.parentElement!;
    expect(group.firstElementChild).toBe(headings[0]);
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Profile & preferences',
      'Sign-in & security',
      'My agents',
      'Assistants',
    ]);
    for (const badge of ['Owner', 'Server', 'New']) {
      expect(screen.queryByText(badge)).toBeNull();
    }
  });

  it('shows the same rows to a member', () => {
    renderNav(SETTINGS_NAV, { role: 'member', isInstanceAdmin: false }, 'preferences', '/settings');
    expect(rowLabels()).toEqual([
      'Profile & preferences',
      'Sign-in & security',
      'My agents',
      'Assistants',
    ]);
  });
});

describe('the console nav', () => {
  // Where you are has to be marked, not merely coloured — that is what a screen reader
  // reads out, and it is the one thing the old chip row got right.
  it('marks the current section', () => {
    renderAdminNav(FOUNDER, 'audit');
    expect(screen.getByRole('button', { name: 'Audit log' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe(
      'false',
    );
  });

  it('finds a section by keyword rather than label alone', () => {
    renderNav(GATED, FOUNDER, 'members');
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'roles' } });
    expect(screen.getByRole('button', { name: 'Members' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Invitations' })).toBeNull();
  });

  it('says so when nothing matched', () => {
    renderServerNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matched.')).toBeTruthy();
  });

  it('badges a newly shipped section', () => {
    renderNav(GATED, FOUNDER, 'members');
    expect(screen.getByRole('button', { name: 'Invitations', description: 'New' })).toBeTruthy();
  });

  // On the row, because only the people who can see the row see the badge, and they have
  // no other way to tell which pages their admins cannot reach. The badge describes the
  // row's button, so a screen reader hears it with the row.
  it('names who may open a restricted row, and leaves an admin’s rows bare', () => {
    renderNav(GATED, FOUNDER, 'members');
    expect(
      screen.getByRole('button', { name: 'Transfer ownership', description: 'Owner' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Errors and logs', description: 'Server' }),
    ).toBeTruthy();
    const members = screen.getByRole('button', { name: 'Members' });
    expect(members.textContent).toBe('Members');
    expect(members.getAttribute('aria-describedby')).toBeNull();
  });

  // Three badges, one element: the same box at the same place on the row, told apart by
  // kind. They were the account menu's pill and two role pills, each its own size.
  it('draws owner, server and new as one kind of badge', () => {
    renderNav(GATED, FOUNDER, 'members');
    const kinds = ['Owner', 'Server', 'New'].map((label) => {
      const badge = screen.getByText(label);
      expect(badge.getAttribute('data-slot')).toBe('sidebar-menu-badge');
      return badge.getAttribute('data-kind');
    });
    expect(kinds).toEqual(['owner', 'instance', 'new']);
    expect(screen.getByRole('button', { name: 'Errors and logs' }).getAttribute('title')).toBe(
      "Only the server's admin can open this.",
    );
  });

  it('offers each restricted row only to whoever passes its gate', () => {
    renderNav(GATED, ADMIN, 'members');
    expect(rowLabels()).toEqual(['Members', 'Invitations']);
    cleanup();

    renderNav(GATED, OWNER, 'members');
    expect(rowLabels()).toEqual(['Members', 'Invitations', 'Transfer ownership']);
  });

  it('offers a way back to the workspace', () => {
    renderServerNav();
    expect(screen.getByRole('button', { name: 'Back to workspace' })).toBeTruthy();
  });

  // Below 768px the nav is a sheet over the page, and choosing a page is what it was
  // opened for.
  it('closes the sheet when a section is chosen', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('max-width'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    render(
      <SidebarProvider>
        <SidebarTrigger aria-label="Open the section menu" />
        <Sidebar>
          <ConsoleNav groups={ADMIN_NAV} section="general" viewer={FOUNDER} />
        </Sidebar>
      </SidebarProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Open the section menu' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Back on the button that opened it, not on <body> with the sheet that held the row.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
