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
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from './Menu.tsx';

afterEach(cleanup);

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

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getByText('Second'));
  });

  it('wrap round the end', () => {
    open();
    screen.getByText('Second').focus();

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('leave a select in the panel to its own options', () => {
    open();
    const select = screen.getByRole('combobox');
    select.focus();

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    // Not moved to a menu item: the browser is changing the option, which is what
    // Down means to somebody who has just focused a select.
    expect(document.activeElement).toBe(select);
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

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(document.activeElement).toBe(field);
  });
});

describe('a menu’s dismissal', () => {
  it('answers Escape', () => {
    const onClose = open();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
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
    // be unmounted by the very click that asked for it.
    const onClose = vi.fn();
    render(
      <Menu open onClose={onClose} className="menu" suspendDismiss>
        <button role="menuitem" type="button">
          First
        </button>
      </Menu>,
    );

    fireEvent.click(document.body);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
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

    fireEvent.keyDown(window, { key: 'Escape' });

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
});
