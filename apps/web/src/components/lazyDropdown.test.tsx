// @vitest-environment happy-dom
/**
 * A menu that owns its trigger, from a module that is not in the first load.
 *
 * `lazyDropdown` is how the shell's menus are drawn: each is an ordinary shadcn
 * `DropdownMenu` with its own `DropdownMenuTrigger`, in a module fetched beside the overlay
 * chunk. Until that module is here a placeholder draws the same trigger without Base UI,
 * and these are its promises: it says it opens a menu, a press on it is not lost, the swap
 * to the real trigger neither opens a menu nobody asked for nor drops focus on the page, a
 * module already here is drawn at once, and a failed fetch costs one press and not the
 * menu.
 *
 * The module here is a real one, built from shadcn's `DropdownMenu`, imported while the
 * file is collected; only the moment its import resolves is the test's to choose.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';
import { lazyDropdown, type DropdownModuleProps } from './lazyDropdown.tsx';
import { preloadAlso } from '../lib/overlays.ts';

// The registration is the case's to look at; nothing here runs the app's preload.
vi.mock('../lib/overlays.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/overlays.ts')>()),
  preloadAlso: vi.fn(),
}));

/** What a later task writes: shadcn's menu, with its own trigger and its own items. */
function AccountMenu({ trigger, defaultOpen }: DropdownModuleProps) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type MenuModule = { default: ComponentType<DropdownModuleProps> };

/** A promise settled from outside: the module, still on the wire. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * An import the test holds: each call is one fetch, which waits until the case lands it
 * (`release`) or drops it (`fail`).
 */
function heldImport() {
  const attempts: ReturnType<typeof deferred<MenuModule>>[] = [];
  const load = vi.fn(() => {
    const attempt = deferred<MenuModule>();
    attempts.push(attempt);
    return attempt.promise;
  });
  return {
    load,
    release: () => attempts.at(-1)!.resolve({ default: AccountMenu }),
    fail: (error: Error) => attempts.at(-1)!.reject(error),
  };
}

const account = () => screen.getByRole('button', { name: 'Account' });

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.mocked(preloadAlso).mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('lazyDropdown', () => {
  it('draws the trigger with aria-haspopup="menu" and aria-expanded="false" before the module arrives', () => {
    const { load } = heldImport();
    const Menu = lazyDropdown(load);

    render(<Menu trigger={<button type="button">Account</button>} />);

    // The same button, saying what it does before the menu behind it exists.
    const trigger = account();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    // Nothing is fetched by drawing it: that is the preload's, or a press's.
    expect(load).not.toHaveBeenCalled();
  });

  it('registers its import to be preloaded with the overlays, and shares it with a press', async () => {
    const { load, release } = heldImport();
    const Menu = lazyDropdown(load);
    expect(preloadAlso).toHaveBeenCalledTimes(1);
    const preload = vi.mocked(preloadAlso).mock.calls[0]![0];

    render(<Menu trigger={<button type="button">Account</button>} />);
    void preload();
    fireEvent.click(account());
    // One fetch, whoever asked first.
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => release());
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('opens the menu once the module arrives when the placeholder was pressed', async () => {
    const { load, release } = heldImport();
    const Menu = lazyDropdown(load);
    const onClick = vi.fn();

    render(
      <Menu
        trigger={
          <button type="button" onClick={onClick}>
            Account
          </button>
        }
      />,
    );
    // From the keyboard: the button had focus when it was pressed.
    account().focus();
    fireEvent.click(account());

    // The trigger's own handler still runs, and the press asked for the module.
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();

    await act(async () => release());

    // The press was held, and the menu is open the moment it can be.
    const menu = screen.getByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeTruthy();
    expect(account().getAttribute('aria-expanded')).toBe('true');
    // And it is the menu Base UI opens: focus goes in, and one Escape brings it home to the
    // trigger that took the placeholder's place.
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(account());
  });

  it('draws the real trigger closed when the module arrives by preload', async () => {
    const { load, release } = heldImport();
    const Menu = lazyDropdown(load);

    render(<Menu trigger={<button type="button">Account</button>} />);
    const placeholder = account();

    const preloaded = Menu.preload();
    await act(async () => {
      release();
      await preloaded;
    });

    // Base UI's trigger now, and nobody asked for the menu, so it is not open.
    const trigger = account();
    expect(trigger).not.toBe(placeholder);
    expect(trigger.getAttribute('data-slot')).toBe('dropdown-menu-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    // And it is Base UI's to open from here.
    fireEvent.click(trigger);
    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('keeps focus on the trigger when the module replaces a focused placeholder', async () => {
    const { load, release } = heldImport();
    const Menu = lazyDropdown(load);

    render(<Menu trigger={<button type="button">Account</button>} />);
    const placeholder = account();
    placeholder.focus();
    expect(document.activeElement).toBe(placeholder);

    const preloaded = Menu.preload();
    await act(async () => {
      release();
      await preloaded;
    });

    // A new element took the placeholder's place, and focus moved with it rather than
    // falling to <body>: a keyboard user is still where they were.
    const trigger = account();
    expect(trigger).not.toBe(placeholder);
    expect(document.activeElement).toBe(trigger);
  });

  it('draws the menu in its first render when the module is already here', async () => {
    const { load, release } = heldImport();
    const Menu = lazyDropdown(load);
    const preloaded = Menu.preload();
    release();
    await preloaded;

    // Every element the trigger was ever drawn as, in order.
    const drawn: HTMLElement[] = [];
    render(
      <Menu
        trigger={
          <button
            type="button"
            ref={(node) => {
              if (node) drawn.push(node);
            }}
          >
            Account
          </button>
        }
      />,
    );

    // No placeholder first: the real trigger was the first thing on the page, and the
    // trigger's own ref reached it.
    expect(drawn[0]?.getAttribute('data-slot')).toBe('dropdown-menu-trigger');
    expect(drawn.every((node) => node === account())).toBe(true);
  });

  it('keeps the placeholder after a failed import and retries on the next press', async () => {
    const { load, release, fail } = heldImport();
    const Menu = lazyDropdown(load);

    render(<Menu trigger={<button type="button">Account</button>} />);
    const placeholder = account();
    fireEvent.click(placeholder);
    await act(async () => fail(new Error('Failed to fetch dynamically imported module')));

    // Still the placeholder, still closed, still saying what it opens.
    expect(account()).toBe(placeholder);
    expect(placeholder.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      consoleError.mock.calls.filter((call) => String(call[0]).includes('menu')),
    ).toHaveLength(1);

    // The next press is a fresh attempt, and this time it lands.
    fireEvent.click(placeholder);
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => release());
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('logs a failed import once, however many presses were waiting on it', async () => {
    const { load, fail } = heldImport();
    const Menu = lazyDropdown(load);

    render(<Menu trigger={<button type="button">Account</button>} />);
    // Pressed again because nothing happened the first time: one fetch, two presses.
    fireEvent.click(account());
    fireEvent.click(account());
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error('Failed to fetch dynamically imported module')));

    expect(
      consoleError.mock.calls.filter((call) => String(call[0]).includes('menu')),
    ).toHaveLength(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

/**
 * A press held while the module is on its way is the person's intent only for as long as
 * they are still there. Once they have gone on — a Tab, an Escape, focus somewhere else —
 * a menu opening late would take focus back from where they went. Focus itself is no
 * test of "still there": WebKit does not focus a button that is clicked, so after a click
 * focus can sit on <body> the whole time, and that press still counts.
 */
describe('a press that moved on before the module landed', () => {
  /** The placeholder pressed, the module still on its way. */
  function pressAndWait() {
    const held = heldImport();
    const Menu = lazyDropdown(held.load);
    render(
      <>
        <Menu trigger={<button type="button">Account</button>} />
        <button type="button">Elsewhere</button>
      </>,
    );
    fireEvent.click(account());
    expect(held.load).toHaveBeenCalledTimes(1);
    return held;
  }

  /** The module lands, and the real trigger is drawn closed with no menu. */
  async function landsClosed(release: () => void) {
    await act(async () => release());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(account().getAttribute('data-slot')).toBe('dropdown-menu-trigger');
    expect(account().getAttribute('aria-expanded')).toBe('false');
  }

  it('does not open the menu when a Tab came before the module', async () => {
    const { release } = pressAndWait();
    fireEvent.keyDown(account(), { key: 'Tab' });
    await landsClosed(release);
  });

  it('does not open the menu when an Escape came before the module', async () => {
    const { release } = pressAndWait();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await landsClosed(release);
  });

  it('does not open the menu when focus went somewhere else before the module', async () => {
    const { release } = pressAndWait();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus());
    await landsClosed(release);
    // And it is left where it went.
    expect(document.activeElement).toBe(elsewhere);
  });

  it('still opens the menu when the press left focus on the page, as a click does in Safari', async () => {
    const { release } = pressAndWait();
    // Nothing took focus: the click did not, and nothing else happened.
    expect(document.activeElement).toBe(document.body);
    // A key that is not a way out leaves the press standing.
    fireEvent.keyDown(document.body, { key: 'Shift' });

    await act(async () => release());

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(account().getAttribute('aria-expanded')).toBe('true');
  });
});
