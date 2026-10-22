// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConsoleNav } from './ConsoleNav.tsx';
import { ADMIN_NAV, SETTINGS_NAV, type NavGroup, type Viewer } from './registry.ts';

// vitest globals are off, so RTL's automatic cleanup never runs. Without this, one
// test's markup is still in the document while the next one queries it.
afterEach(cleanup);

const ADMIN: Viewer = { role: 'admin', isInstanceAdmin: false };
const OWNER: Viewer = { role: 'owner', isInstanceAdmin: false };
const FOUNDER: Viewer = { role: 'owner', isInstanceAdmin: true };

/** The server console's nav as AdminConsole hands it over: one list, under no heading. */
const SERVER: NavGroup[] = [{ id: 'server', sections: ADMIN_NAV }];

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

function renderServerNav(viewer: Viewer = FOUNDER, section = 'general') {
  return render(<ConsoleNav groups={SERVER} section={section} viewer={viewer} />);
}

/** The rows the nav draws, by label, in order. */
function rowLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.sidebar-scroll .channel-name')].map(
    (node) => node.textContent ?? '',
  );
}

describe('the server console’s nav', () => {
  it('is one list with no headings, in the registry’s order', () => {
    const { container } = renderServerNav();
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(container.querySelector('.section-label')).toBeNull();
    expect(container.querySelector('.section-note')).toBeNull();
    expect(rowLabels(container)).toEqual([
      'General',
      'Appearance',
      'People',
      'Channels',
      'Emoji',
      'Huddles',
      'Video meetups',
      'Apps & agents',
      'Janus',
      'MCP servers',
      'Usage',
      'Approvals',
      'Export',
      'Import',
      'Security',
      'Retention',
      'Webhooks',
      'Deliveries',
      'Assistants',
      'Single sign-on',
      'App policy',
      'Health',
      'Audit log',
      'Errors and logs',
      'Feedback',
    ]);
  });

  it('draws nothing that is not a page', () => {
    renderServerNav();
    expect(screen.queryByText('Soon')).toBeNull();
    // Approvals was one of these, until it became a page that opens (M4).
    for (const gone of ['Moderation', 'Storage', 'Import / export']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByText('Only you can see these.')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });

  // Their pages answer nobody else; an owner of this workspace is not enough.
  it('keeps the server’s own pages from an admin and from an owner who does not run it', () => {
    for (const viewer of [ADMIN, OWNER]) {
      const { container, unmount } = renderServerNav(viewer);
      const rows = rowLabels(container);
      expect(rows).not.toContain('App policy');
      expect(rows).not.toContain('Errors and logs');
      expect(rows).toContain('Health');
      expect(rows).toContain('Audit log');
      expect(rows).toContain('Feedback');
      expect(screen.queryByText('Server')).toBeNull();
      unmount();
    }
  });

  it('badges the server’s own pages for the person who runs it', () => {
    renderServerNav();
    const badged = screen
      .getAllByText('Server')
      .map((badge) => badge.closest('button')?.querySelector('.channel-name')?.textContent);
    expect(badged).toEqual(['Single sign-on', 'App policy', 'Errors and logs']);
    expect(screen.getByText('Audit log').closest('button')?.textContent).toBe('Audit log');
  });

  it('narrows the list to what was typed, without leaving a heading behind', () => {
    const { container } = renderServerNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'log' } });
    expect(rowLabels(container)).toEqual([
      'Single sign-on',
      'App policy',
      'Audit log',
      'Errors and logs',
    ]);
    expect(screen.queryAllByRole('heading')).toEqual([]);

    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: '' } });
    expect(rowLabels(container)).toHaveLength(25);
  });
});

// Settings is not part of the change, and shares this component: its heading and its
// rows have to come out exactly as they did.
describe('the settings nav', () => {
  it('keeps its heading over its four rows, with nothing else on them', () => {
    const { container } = render(
      <ConsoleNav groups={SETTINGS_NAV} section="preferences" viewer={ADMIN} basePath="/settings" />,
    );
    const headings = screen.getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual(['You']);
    expect(headings[0]?.tagName).toBe('H2');
    expect(headings[0]?.className).toBe('section-label');

    const section = container.querySelector('.sidebar-scroll > section.sidebar-section');
    expect(section?.firstElementChild).toBe(headings[0]);
    expect(rowLabels(container)).toEqual([
      'Profile & preferences',
      'Sign-in & security',
      'My agents',
      'Assistants',
    ]);
    expect(container.querySelector('.console-nav-badge')).toBeNull();
  });

  it('shows the same rows to a member', () => {
    const { container } = render(
      <ConsoleNav
        groups={SETTINGS_NAV}
        section="preferences"
        viewer={{ role: 'member', isInstanceAdmin: false }}
        basePath="/settings"
      />,
    );
    expect(rowLabels(container)).toEqual([
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
    renderServerNav(FOUNDER, 'audit');
    const current = screen.getByText('Audit log').closest('button');
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('General').closest('button')?.getAttribute('aria-current')).toBe(
      'false',
    );
  });

  it('finds a section by keyword rather than label alone', () => {
    render(<ConsoleNav groups={GATED} section="members" viewer={FOUNDER} />);
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'roles' } });
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.queryByText('Invitations')).toBeNull();
  });

  it('says so when nothing matched', () => {
    renderServerNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matched.')).toBeTruthy();
  });

  it('badges a newly shipped section', () => {
    render(<ConsoleNav groups={GATED} section="members" viewer={FOUNDER} />);
    expect(screen.getByText('New').closest('button')?.textContent).toContain('Invitations');
  });

  // On the row, because only the people who can see the row see the badge, and they have
  // no other way to tell which pages their admins cannot reach.
  it('names who may open a restricted row, and leaves an admin’s rows bare', () => {
    render(<ConsoleNav groups={GATED} section="members" viewer={FOUNDER} />);
    expect(screen.getByText('Transfer ownership').closest('button')?.textContent).toContain(
      'Owner',
    );
    expect(screen.getByText('Errors and logs').closest('button')?.textContent).toContain(
      'Server',
    );
    expect(screen.getByText('Members').closest('button')?.textContent).toBe('Members');
  });

  // Three badges, one element: the same box at the same place on the row, told apart by
  // kind. They were the account menu's pill and two role pills, each its own size.
  it('draws owner, server and new as one kind of badge', () => {
    render(<ConsoleNav groups={GATED} section="members" viewer={FOUNDER} />);
    const kinds = ['Owner', 'Server', 'New'].map((label) => {
      const badge = screen.getByText(label);
      expect(badge.className).toBe('console-nav-badge');
      return badge.getAttribute('data-kind');
    });
    expect(kinds).toEqual(['owner', 'instance', 'new']);
    expect(screen.getByText('Server').getAttribute('title')).toBe(
      "Only the server's admin can open this.",
    );
  });

  it('offers each restricted row only to whoever passes its gate', () => {
    const { container } = render(<ConsoleNav groups={GATED} section="members" viewer={ADMIN} />);
    expect(rowLabels(container)).toEqual(['Members', 'Invitations']);
    cleanup();

    const owner = render(<ConsoleNav groups={GATED} section="members" viewer={OWNER} />);
    expect(rowLabels(owner.container)).toEqual(['Members', 'Invitations', 'Transfer ownership']);
  });

  it('offers a way back to the workspace', () => {
    renderServerNav();
    expect(screen.getByText('Back to workspace')).toBeTruthy();
  });

  it('closes the drawer when a section is chosen', () => {
    const onNavigate = vi.fn();
    render(<ConsoleNav groups={SERVER} section="general" viewer={FOUNDER} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Audit log'));
    expect(onNavigate).toHaveBeenCalled();
  });
});
