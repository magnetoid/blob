// @vitest-environment happy-dom
/** The house dismissal-and-arrows contract, once.
 *
 * Three menus grew three private copies of this wiring before it was one component, so
 * the behaviour is worth pinning where it now lives rather than in each caller.
 *
 * The case that motivated the file: a menu is not always only menu items. The schedule
 * menu holds a repeat select and a time field, and Up/Down on either of those belongs to
 * the control — a select changes its option, a date field steps its segment. Steering
 * focus to the next menu item instead makes both unusable by keyboard, and the failure
 * is invisible to anyone testing with a mouse.
 *
 * The panel is Base UI's menu popup now, from the overlay chunk, which is already here in
 * every test below (`src/test/overlayChunk.ts`) as it normally is in the app by the time
 * anybody opens a menu. A menu opened before the chunk lands is `Menu.chunk.test.tsx`'s.
 * Keys go where the browser sends them — to whatever has focus — except where a case says
 * the menu is open with nothing in it focused yet.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Menu } from './Menu.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { Dialog, DialogPresence } from './Dialog.tsx';
import '../test/overlayChunk.ts';

afterEach(cleanup);

/** A key as the browser sends it: to whatever has focus. */
function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

function open(onClose = vi.fn()) {
  render(
    <Menu open onClose={onClose} className="menu">
      <button role="menuitem" type="button">
        First
      </button>
      <button role="menuitem" type="button">
        Second
      </button>
      <label>
        Repeat
        <select name="repeat" defaultValue="">
          <option value="">Doesn’t repeat</option>
          <option value="daily">Every day</option>
        </select>
      </label>
    </Menu>,
  );
  return onClose;
}

describe('a menu’s arrows', () => {
  it('walk its items', () => {
    open();
    screen.getByText('First').focus();

    press('ArrowDown');

    expect(document.activeElement).toBe(screen.getByText('Second'));
  });

  it('wrap round the end', () => {
    open();
    screen.getByText('Second').focus();

    press('ArrowDown');

    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('leave a select in the panel to its own options', () => {
    open();
    const select = screen.getByRole('combobox');
    select.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(event);

    // Not moved to a menu item, and the key not spent: the browser is changing the
    // option, which is what Down means to somebody who has just focused a select.
    expect(document.activeElement).toBe(select);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leave a text field in the panel to its own caret', () => {
    render(
      <Menu open onClose={vi.fn()} className="menu">
        <button role="menuitem" type="button">
          Only item
        </button>
        <input aria-label="When" type="datetime-local" />
      </Menu>,
    );
    const field = screen.getByLabelText('When');
    field.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    field.dispatchEvent(event);

    expect(document.activeElement).toBe(field);
    expect(event.defaultPrevented).toBe(false);
  });

  it('step into the panel from the button that opened it', () => {
    // Focus can still be on the trigger — a click leaves it there in most browsers, and
    // nowhere at all in Safari — and Down from there means "into the menu".
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    open();

    press('ArrowDown');

    expect(document.activeElement).toBe(screen.getByText('First'));
    trigger.remove();
  });

  it('walk its items inside a dialog too', () => {
    // Base UI's dialog popup stops the arrow keys at its edge, so a menu inside one
    // cannot wait for them to reach `window` the way the shell's keys do.
    render(
      <Dialog label="Settings" onClose={vi.fn()}>
        <Menu open onClose={vi.fn()} className="menu">
          <button role="menuitem" type="button">
            First
          </button>
          <button role="menuitem" type="button">
            Second
          </button>
        </Menu>
      </Dialog>,
    );
    screen.getByText('First').focus();

    press('ArrowDown');

    expect(document.activeElement).toBe(screen.getByText('Second'));
  });
});

describe('a menu’s panel', () => {
  it('carries the class its caller styles it by, and the menu role', () => {
    open();
    expect(menu()?.classList.contains('menu')).toBe(true);
    expect(menu()?.querySelectorAll('[role="menuitem"]').length).toBe(2);
  });

  it('is drawn beside its trigger, not at the end of the page', () => {
    // Where the old panel sat, inside the caller's own markup: the message toolbar stays up
    // on `:focus-within` its row, a message row is lifted by `:has(.menu)`, a menu inside a
    // dialog is inside the dialog, and Tab from the trigger reaches the panel next.
    render(
      <div data-testid="caller">
        <button type="button">Options</button>
        <Menu open onClose={vi.fn()} className="menu">
          <button role="menuitem" type="button">
            First
          </button>
        </Menu>
      </div>,
    );
    expect(screen.getByTestId('caller').contains(menu())).toBe(true);
  });

  it('hangs where its own stylesheet says', async () => {
    // Each caller's CSS still decides where its panel goes — above the composer, or from
    // the right edge of a row — as it did with `top` and `right`; now in the properties
    // the positioner reads.
    const style = document.createElement('style');
    style.textContent = '.up { --menu-side: top; --menu-align: end; }';
    document.head.append(style);
    render(
      <Menu open onClose={vi.fn()} className="menu up">
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );
    // Placed a microtask later, as the positioner always places.
    await waitFor(() => expect(menu()?.getAttribute('data-side')).toBe('top'));
    expect(menu()?.getAttribute('data-align')).toBe('end');
    style.remove();
  });

  it('takes focus to its first item as it opens', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    open();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('First')));
    trigger.remove();
  });

  it('draws nothing of the chunk while it is closed', () => {
    // The first load carries only the anchor the panel will hang from.
    render(
      <Menu open={false} onClose={vi.fn()} className="menu">
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );
    expect(menu()).toBeNull();
    expect(screen.queryByText('First')).toBeNull();
  });

  it('leaves the document once its exit is over', async () => {
    const { rerender } = render(
      <Menu open onClose={vi.fn()} className="menu">
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );
    rerender(
      <Menu open={false} onClose={vi.fn()} className="menu">
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );

    // Closed at once — for the stylesheet to play the exit off, and for nobody to click —
    // and gone when the exit is over.
    expect(menu()?.hasAttribute('data-closed')).toBe(true);
    await waitFor(() => expect(menu()).toBeNull());
  });

  it('hides the focus guards Base UI draws round it, by the attribute they carry', () => {
    // The canary for a Base UI upgrade. Base UI puts a focusable span either side of a
    // portal to carry Tab from a trigger to a panel drawn elsewhere; this panel is drawn
    // in place, and a guard left showing after its last item swallows the Tab that should
    // move on. `Menu` hides them with a Tailwind class naming the attribute Base UI stamps
    // on them — hardcoded in its `utils/FocusGuard`, and renamed once already, from
    // floating-ui's prefix to Base UI's. happy-dom applies no Tailwind, so what is checked
    // is the tie: the guards, found by what they are rather than by that attribute, must
    // all match the selector inside the class. A rename upstream fails here, not as Tab
    // stranded on an invisible span at the end of every menu.
    const { container } = render(
      <Menu open onClose={vi.fn()} className="menu">
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );
    const wrapper = container.firstElementChild as HTMLElement;

    const hiding = [...wrapper.classList].find((name) => name.endsWith(':hidden!'));
    expect(hiding).toBe('[&_[data-base-ui-focus-guard]]:hidden!');
    const selector = /^\[&_(.+)\]:hidden!$/.exec(hiding ?? '')?.[1] ?? '';

    // A guard: a span the keyboard reaches and a screen reader is told to skip.
    const guards = [
      ...wrapper.querySelectorAll<HTMLElement>('span[tabindex="0"][aria-hidden="true"]'),
    ];
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) expect(guard.matches(selector)).toBe(true);
  });
});

describe('a menu’s dismissal', () => {
  it('answers Escape', () => {
    const onClose = open();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('returns focus to its opener and makes the exiting panel inert', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Open menu</button>
        <Menu open={false} onClose={onClose} className="menu">
          <button role="menuitem" type="button">
            First
          </button>
        </Menu>
      </>,
    );
    const trigger = screen.getByText('Open menu');
    trigger.focus();
    rerender(
      <>
        <button type="button">Open menu</button>
        <Menu open onClose={onClose} className="menu">
          <button role="menuitem" type="button">
            First
          </button>
        </Menu>
      </>,
    );
    screen.getByText('First').focus();

    rerender(
      <>
        <button type="button">Open menu</button>
        <Menu open={false} onClose={onClose} className="menu">
          <button role="menuitem" type="button">
            First
          </button>
        </Menu>
      </>,
    );

    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('menu')).toHaveProperty('inert', true);
  });

  it('closes on a click outside the panel', () => {
    const onClose = open();

    fireEvent.click(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it('stays open for a click on its own contents', () => {
    const onClose = open();

    fireEvent.click(screen.getByText('First'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('is suspended while the caller has a dialog up', () => {
    // A dialog rendered beside the panel is "outside" by the contains test, and would
    // be unmounted by the very click that asked for it — or by the focus it takes.
    const onClose = vi.fn();
    const dialog = document.createElement('button');
    document.body.append(dialog);
    render(
      <Menu open onClose={onClose} className="menu" suspendDismiss>
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );

    fireEvent.click(document.body);
    fireEvent.keyDown(window, { key: 'Escape' });
    screen.getByText('First').focus();
    dialog.focus();

    expect(onClose).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('closes when focus moves out of it, and not while it moves within it', () => {
    // Tab past its last item, or Shift+Tab back to its trigger, as a menu does elsewhere.
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    const onClose = open();
    screen.getByText('First').focus();
    screen.getByText('Second').focus();

    expect(onClose).not.toHaveBeenCalled();

    elsewhere.focus();

    expect(onClose).toHaveBeenCalledTimes(1);
    elsewhere.remove();
  });

  it('leaves focus where Tab sent it', () => {
    // Mid-move, as the browser has it: the menu hears focus leave before focus has landed
    // anywhere, so "lost on <body>" is no sign it should be brought back to the trigger.
    function Options() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Menu open={open} onClose={() => setOpen(false)} className="menu">
            <button role="menuitem" type="button">
              Last
            </button>
          </Menu>
          <button type="button">Catch up</button>
        </>
      );
    }
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    render(<Options />);
    const last = screen.getByText('Last');
    last.focus();

    fireEvent.focusOut(last, { relatedTarget: screen.getByText('Catch up') });

    expect(document.activeElement).not.toBe(trigger);
    trigger.remove();
  });

  it('closes once: focus going home is not focus leaving', () => {
    const onClose = vi.fn();
    function Options() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button">Options</button>
          <Menu
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            className="menu"
          >
            <button role="menuitem" type="button">
              First
            </button>
          </Menu>
        </>
      );
    }
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    render(<Options />);
    screen.getByText('First').focus();

    press('Escape');

    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});

describe('a menu’s Escape', () => {
  it('does not also reach the shell', () => {
    // Two bubble listeners on `window` both run, so a menu closing itself never stopped
    // the shell from acting on the same key — closing the thread panel behind it, or
    // marking the channel read and destroying a mark-unread. `lib/useEscape` owns one
    // capture-phase listener and a stack; the menu is on it while it is open.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    const onClose = open();
    screen.getByText('First').focus();

    press('Escape');

    expect(onClose).toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
    window.removeEventListener('keydown', shell);
  });

  it('and leaves the key alone while the caller has a dialog up', () => {
    // `suspendDismiss` — a dialog rendered beside the panel would be unmounted by the
    // very key that asked for it.
    const onClose = vi.fn();
    render(
      <Menu open onClose={onClose} className="menu" suspendDismiss>
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('one Escape closes the dialog a menu item opened, the next closes the menu, and focus lands on the trigger', async () => {
    // The channel menu's Archive, as `ChannelMenu` draws it: the confirm renders beside
    // the menu, the menu sits out its dismissal while the confirm is up, and the menu is
    // closed by its parent unmounting it.
    function ChannelOptions() {
      const [open, setOpen] = useState(false);
      const [asking, setAsking] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Options for general
          </button>
          {open && (
            <>
              <Menu open onClose={() => setOpen(false)} className="menu" suspendDismiss={asking}>
                <button role="menuitem" type="button" onClick={() => setAsking(true)}>
                  Archive channel
                </button>
              </Menu>
              <DialogPresence when={asking}>
                {() => (
                  <ConfirmDialog
                    title="Archive #general?"
                    body="It becomes read-only for everybody."
                    confirmLabel="Archive"
                    danger
                    onClose={() => setAsking(false)}
                    onConfirm={() => setAsking(false)}
                  />
                )}
              </DialogPresence>
            </>
          )}
        </>
      );
    }
    render(<ChannelOptions />);
    const trigger = screen.getByText('Options for general');
    trigger.focus();
    fireEvent.click(trigger);
    const item = screen.getByText('Archive channel');
    item.focus();
    fireEvent.click(item);
    const confirm = screen.getByRole('alertdialog', { name: 'Archive #general?' });
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));

    press('Escape');

    // The confirm goes; the menu stays, and has the item that asked back.
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    expect(menu()?.hasAttribute('data-open')).toBe(true);
    expect(document.activeElement).toBe(item);

    press('Escape');

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes a menu inside a dialog with one Escape and leaves the dialog open; the next closes the dialog', () => {
    const closeDialog = vi.fn();
    function Settings() {
      const [open, setOpen] = useState(false);
      return (
        <Dialog label="Settings" onClose={closeDialog}>
          <div className="dialog">
            <button type="button" onClick={() => setOpen(true)}>
              More
            </button>
            <Menu open={open} onClose={() => setOpen(false)} className="menu">
              <button role="menuitem" type="button">
                First
              </button>
            </Menu>
          </div>
        </Dialog>
      );
    }
    render(<DialogPresence when>{() => <Settings />}</DialogPresence>);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const more = screen.getByText('More');
    more.focus();
    fireEvent.click(more);
    // Drawn inside the dialog, so it is above the dialog's own contents without a step of
    // its own on the stacking ladder.
    expect(dialog.contains(menu())).toBe(true);
    screen.getByText('First').focus();

    press('Escape');

    expect(menu()?.hasAttribute('data-closed')).toBe(true);
    expect(closeDialog).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(more);

    press('Escape');

    expect(closeDialog).toHaveBeenCalledTimes(1);
  });
});
