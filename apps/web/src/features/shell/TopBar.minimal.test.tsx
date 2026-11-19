// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TopBar } from './TopBar.tsx';
import { SidebarProvider } from '../../components/ui/sidebar.tsx';
import { useStore } from '../../lib/store.ts';
import { navigate } from '../../lib/router.ts';
// Below 768px the list is a Sheet, which comes from the overlay chunk: here before the case.
import '../../test/overlayChunk.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

/** A phone: the sidebar's breakpoint is read from the media query, as the stylesheet's is. */
function narrow() {
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
}

function signedIn(role = 'owner') {
  useStore.setState({
    workspaceName: 'Imba',
    currentUser: { id: 'u1', displayName: 'Marko', role },
    status: 'online',
  } as never);
}

/** The chat shell's bar: inside the sidebar's provider, as `app/Workspace.tsx` draws it. */
function chat(children: ReactNode) {
  return <SidebarProvider>{children}</SidebarProvider>;
}

describe('the minimal top bar', () => {
  it('shows the team name, search, invite and the account menu', () => {
    signedIn();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));

    expect(screen.getByText('Imba')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    // A huddle starts from a conversation's header, beside Meetup; the top bar's disabled
    // placeholder for it is gone.
    expect(screen.queryByRole('button', { name: 'Huddle' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Invite people' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marko/ })).toBeTruthy();
    expect(screen.queryByText('Feedback')).toBeNull();
  });

  it('draws no view tabs: Activity, Files and Channels are rows in the channel list', () => {
    signedIn();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));

    for (const name of ['Messages', 'Activity', 'Files', 'Channels']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('offers Invite to admins only', () => {
    signedIn('member');
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull();
  });

  it('opens invitations from Invite', () => {
    signedIn();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));
    fireEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    expect(navigateMock).toHaveBeenCalledWith('/admin/invitations');
  });

  it('navigates to search from the centred search control', () => {
    signedIn();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(navigateMock).toHaveBeenCalledWith('/search');
  });

  it('opens the palette instead when it has one', () => {
    signedIn();
    const onSearch = vi.fn();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal onSearch={onSearch} />));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('keeps the search label as text, whatever the width', () => {
    signedIn();
    narrow();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));
    expect(screen.getByRole('button', { name: 'Search' }).textContent).toContain('Search');
  });

  it('draws the workspace mark as decoration, never as a control', () => {
    signedIn();
    const { container } = render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));
    const mark = [...container.querySelectorAll('[aria-hidden="true"]')].find(
      (node) => node.textContent === 'I',
    );
    expect(mark).toBeTruthy();
    expect(mark?.closest('button')).toBeNull();
  });
});

describe('the channel list trigger', () => {
  it('folds the list from 768px, and says which way it goes', () => {
    signedIn();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));

    const hide = screen.getByRole('button', { name: 'Hide channel list' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(hide);

    const show = screen.getByRole('button', { name: 'Show channel list' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Hide channel list' })).toBeNull();
    fireEvent.click(show);
    expect(screen.getByRole('button', { name: 'Hide channel list' })).toBeTruthy();
  });

  it('opens the Sheet below 768px, and says which way it goes', async () => {
    signedIn();
    narrow();
    render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));

    const open = screen.getByRole('button', { name: 'Open channel list' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Hide channel list' })).toBeNull();
    fireEvent.click(open);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Close channel list' }).getAttribute('aria-expanded'),
      ).toBe('true'),
    );
  });

  it('is the one button, with no ≡ beside it', () => {
    signedIn();
    const { container } = render(chat(<TopBar onFeedback={vi.fn()} view="messages" minimal />));
    expect(screen.getAllByRole('button', { name: /channel list/ })).toHaveLength(1);
    expect(container.querySelector('.topbar-hamburger')).toBeNull();
  });
});

describe('the console bar', () => {
  it('draws no list trigger — its provider is the section menu, not the channel list', () => {
    signedIn();
    // No provider here at all: a trigger would have thrown asking for one.
    render(<TopBar onFeedback={vi.fn()} view="admin" />);
    expect(screen.queryByRole('button', { name: /channel list/ })).toBeNull();
  });

  it('keeps Messages, Search and Feedback — the account menu has the rest', () => {
    signedIn();
    const onFeedback = vi.fn();
    render(<TopBar onFeedback={onFeedback} view="admin" />);

    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Administration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preferences' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(navigateMock).toHaveBeenCalledWith('/');
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }));
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it('draws the workspace mark as decoration here too', () => {
    signedIn();
    const { container } = render(<TopBar onFeedback={vi.fn()} view="admin" />);
    const mark = [...container.querySelectorAll('[aria-hidden="true"]')].find(
      (node) => node.textContent === 'I',
    );
    expect(mark).toBeTruthy();
  });
});

describe('the bar', () => {
  it('carries a stable hook for the styles that key on it', () => {
    signedIn();
    render(<TopBar onFeedback={vi.fn()} view="admin" />);
    expect(screen.getByRole('banner').getAttribute('data-slot')).toBe('topbar');
  });
});
