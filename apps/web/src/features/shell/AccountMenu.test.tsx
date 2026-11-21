// @vitest-environment happy-dom
/**
 * The account menu's module, drawn on its own: shadcn's menu with the button that opens it
 * handed in, as `lazyDropdown` does. What it pins is which rows a viewer is offered, that
 * What's new says when there is a release to read, that Feedback waits for the menu to be
 * gone, that a change of path closes it, and that an Escape is the menu's while it is open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useStore } from '../../lib/store.ts';
import { navigate } from '../../lib/router.ts';
import { useEscape } from '../../lib/useEscape.ts';
import AccountMenu from './AccountMenu.tsx';

let path = '/';
vi.mock('../../lib/router.ts', () => ({
  navigate: vi.fn(),
  usePath: () => path,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // A case that holds the animation frames back must not hold them back for the next one:
  // Base UI waits on a frame to take a closed menu off the page.
  vi.restoreAllMocks();
  path = '/';
});

function as(role: string, extra: Record<string, unknown> = {}) {
  useStore.setState({
    currentUser: {
      id: 'u1',
      displayName: 'Marko',
      email: 'marko@example.com',
      role,
      avatarUrl: null,
      ...extra,
    },
  } as never);
}

function menu(props: { onFeedback?: () => void; unseenRelease?: boolean } = {}) {
  return render(
    <AccountMenu
      trigger={<button type="button">Account</button>}
      defaultOpen
      onFeedback={props.onFeedback ?? vi.fn()}
      unseenRelease={props.unseenRelease ?? false}
    />,
  );
}

const names = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

describe('the account menu', () => {
  it('opens on the person: their name and address first', async () => {
    as('member');
    menu();
    expect(await screen.findByText('Marko')).toBeTruthy();
    expect(screen.getByText('marko@example.com')).toBeTruthy();
  });

  it('lists the items a member may open', async () => {
    as('member');
    menu();
    await screen.findByRole('menuitem', { name: 'Help' });
    expect(names()).toEqual(['User profile', 'Preferences', 'Help', "What's new", 'Feedback']);
  });

  it('adds Workspace settings for an admin', async () => {
    as('admin');
    menu();
    await screen.findByRole('menuitem', { name: 'Help' });
    expect(names()).toEqual([
      'Workspace settings',
      'User profile',
      'Preferences',
      'Help',
      "What's new",
      'Feedback',
    ]);
  });

  it('adds Server for the instance administrator, whatever their role here', async () => {
    as('member', { isInstanceAdmin: true });
    menu();
    await screen.findByRole('menuitem', { name: 'Help' });
    expect(names()).toEqual([
      'Server',
      'User profile',
      'Preferences',
      'Help',
      "What's new",
      'Feedback',
    ]);
  });

  it('goes to a page from its row', async () => {
    as('member');
    menu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Help' }));
    expect(vi.mocked(navigate)).toHaveBeenCalledWith('/help');
  });

  it("marks What's new while a release is unseen, and only then", async () => {
    as('member');
    const { unmount } = menu({ unseenRelease: true });
    const row = await screen.findByRole('menuitem', { name: /What's new/ });
    expect(row.querySelector('[aria-label="New since you last looked"]')).toBeTruthy();
    expect(screen.getAllByLabelText('New since you last looked')).toHaveLength(1);
    unmount();

    menu({ unseenRelease: false });
    await screen.findByRole('menuitem', { name: "What's new" });
    expect(screen.queryByLabelText('New since you last looked')).toBeNull();
  });

  it('runs Feedback after the menu has closed', async () => {
    as('member');
    let menuOnPage: boolean | null = null;
    const onFeedback = vi.fn(() => {
      menuOnPage = screen.queryByRole('menu') !== null;
    });
    menu({ onFeedback });

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Feedback' }));
    // Not in the same breath as the click: the menu is still on its way out.
    expect(onFeedback).not.toHaveBeenCalled();
    await waitFor(() => expect(onFeedback).toHaveBeenCalledTimes(1));
    expect(menuOnPage).toBe(false);
  });

  it('closes when the path changes under it', async () => {
    as('member');
    const { rerender } = menu();
    await screen.findByRole('menu');

    path = '/help';
    await act(async () => {
      rerender(
        <AccountMenu
          trigger={<button type="button">Account</button>}
          defaultOpen
          onFeedback={vi.fn()}
          unseenRelease={false}
        />,
      );
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('leaving while Feedback waits', () => {
  it('does not open Feedback after the menu is gone from the page', async () => {
    as('member');
    const onFeedback = vi.fn();
    const { unmount } = menu({ onFeedback });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Feedback' }));
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    await waitFor(() => expect(frames.length).toBe(1));
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});

/**
 * The top bar's menus take their place on the Escape stack as they open, as the channel
 * list's do (`features/channels/ChannelMenu.test.tsx`): a file panel open behind the account
 * menu hears the Escape after the one that closes the menu, not that one.
 */
describe('Escape, with something open under the menu', () => {
  /** What was open before the menu: the file panel, say, which holds `useEscape(onClose)`. */
  function Underneath({ onClose }: { onClose: () => void }) {
    useEscape(onClose);
    return null;
  }

  it('closes the menu, and the next Escape goes on to what is under it', async () => {
    as('member');
    const underneath = vi.fn();
    render(
      <>
        <Underneath onClose={underneath} />
        <AccountMenu
          trigger={<button type="button">Account</button>}
          onFeedback={vi.fn()}
          unseenRelease={false}
        />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Account' });
    fireEvent.click(trigger);
    const item = await screen.findByRole('menuitem', { name: 'Help' });
    item.focus();

    fireEvent.keyDown(item, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(underneath).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(underneath).toHaveBeenCalledTimes(1);
  });
});
