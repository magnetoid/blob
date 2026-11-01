// @vitest-environment happy-dom
/**
 * A panel about something, beside the trigger its caller draws: the person card today.
 *
 * It keeps the menus' dismissal contract — the same one, from `lib/useDismissal.ts`, not
 * a copy: three copies of it drifted apart before there was one. What it does not keep
 * is the menus' arrows: what is inside a popover is not a list of items, and its popup is
 * a dialog with a name.
 *
 * The panel is Base UI's popover, from the overlay chunk, which is here before the first
 * test (`src/test/overlayChunk.ts`). One opened before the chunk lands is
 * `Popover.chunk.test.tsx`'s.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Popover } from './Popover.tsx';
import { Dialog, DialogPresence } from './Dialog.tsx';
import '../test/overlayChunk.ts';

afterEach(cleanup);

function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

const popover = () => document.querySelector<HTMLElement>('[role="dialog"]');

function open(onClose = vi.fn()) {
  render(
    <Popover open onClose={onClose} label="Ana" className="card">
      <p>Editor</p>
      <button type="button">Message Ana</button>
      <button type="button">Call Ana</button>
    </Popover>,
  );
  return onClose;
}

describe('a popover’s panel', () => {
  it('is a dialog named for what it is about, carrying its caller’s class', () => {
    open();

    const panel = screen.getByRole('dialog', { name: 'Ana' });
    expect(panel.classList.contains('card')).toBe(true);
    // shadcn's popover surface, by the slot its look is keyed on.
    expect(panel.getAttribute('data-slot')).toBe('popover-content');
  });

  it('is drawn beside its trigger, not at the end of the page', () => {
    render(
      <div data-testid="caller">
        <button type="button">Ana</button>
        <Popover open onClose={vi.fn()} label="Ana">
          <button type="button">Message Ana</button>
        </Popover>
      </div>,
    );
    expect(screen.getByTestId('caller').contains(popover())).toBe(true);
  });

  it('is drawn inside a dialog it opens in, so it is above the dialog without a step of its own', () => {
    render(
      <DialogPresence when>
        {() => (
          <Dialog label="Members" onClose={vi.fn()}>
            <div className="dialog">
              <Popover open onClose={vi.fn()} label="Ana">
                <button type="button">Message Ana</button>
              </Popover>
            </div>
          </Dialog>
        )}
      </DialogPresence>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Members' });
    expect(dialog.contains(screen.getByRole('dialog', { name: 'Ana' }))).toBe(true);
  });

  it('takes focus to the first thing in it that takes focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    open();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Message Ana')));
    trigger.remove();
  });

  it('takes that focus without scrolling anything to it', async () => {
    // Focus goes in as the panel opens, and the panel can still be where Base UI put it
    // before it read where the panel hangs — off the bottom of the page, for one that hangs
    // above the composer. A focus that scrolls brings that spot into view, and it scrolls
    // whatever clips the page: the whole shell moved up and stayed there.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    open();

    const message = screen.getByText('Message Ana');
    await waitFor(() => expect(document.activeElement).toBe(message));
    const options = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === message).map(([o]) => o);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o).toEqual({ preventScroll: true });

    focus.mockRestore();
    trigger.remove();
  });

  it('leaves the arrows alone: it is not a menu', () => {
    open();
    screen.getByText('Message Ana').focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event);

    expect(document.activeElement).toBe(screen.getByText('Message Ana'));
    expect(event.defaultPrevented).toBe(false);
  });

  it('draws nothing of the chunk while it is closed', () => {
    render(
      <Popover open={false} onClose={vi.fn()} label="Ana">
        <button type="button">Message Ana</button>
      </Popover>,
    );
    expect(popover()).toBeNull();
    expect(screen.queryByText('Message Ana')).toBeNull();
  });

  it('leaves the document once its exit is over', async () => {
    const { rerender } = render(
      <Popover open onClose={vi.fn()} label="Ana">
        <button type="button">Message Ana</button>
      </Popover>,
    );
    rerender(
      <Popover open={false} onClose={vi.fn()} label="Ana">
        <button type="button">Message Ana</button>
      </Popover>,
    );

    expect(popover()?.hasAttribute('data-closed')).toBe(true);
    expect(popover()).toHaveProperty('inert', true);
    await waitFor(() => expect(popover()).toBeNull());
  });

  it('hides the focus guards Base UI draws round it, by the attribute they carry', () => {
    // The canary for a Base UI upgrade, as `Menu.test.tsx` has for the menu. The popover is
    // drawn in place, so the page's own order already carries Tab into it and on; a guard
    // left showing after its last control swallows that Tab. happy-dom applies no
    // Tailwind, so what is checked is the tie between the class that hides them and the
    // guards Base UI actually draws, found by what they are rather than by that attribute.
    const { container } = render(
      <Popover open onClose={vi.fn()} label="Ana">
        <button type="button">Message Ana</button>
      </Popover>,
    );
    const wrapper = container.firstElementChild as HTMLElement;

    const hiding = [...wrapper.classList].find((name) => name.endsWith(':hidden!'));
    expect(hiding).toBe('[&_[data-base-ui-focus-guard]]:hidden!');
    const selector = /^\[&_(.+)\]:hidden!$/.exec(hiding ?? '')?.[1] ?? '';

    const guards = [
      ...wrapper.querySelectorAll<HTMLElement>('span[tabindex="0"][aria-hidden="true"]'),
    ];
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) expect(guard.matches(selector)).toBe(true);
  });
});

describe('a popover’s dismissal — the menus’ contract, shared', () => {
  it('answers Escape, and the shell behind it does not hear the key', () => {
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    const onClose = open();
    screen.getByText('Message Ana').focus();

    press('Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
    window.removeEventListener('keydown', shell);
  });

  it('closes on a click outside it, and not on one inside it', () => {
    const onClose = open();

    fireEvent.click(screen.getByText('Editor'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when focus moves out of it, and not while it moves within it', () => {
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    const onClose = open();
    screen.getByText('Message Ana').focus();
    screen.getByText('Call Ana').focus();

    expect(onClose).not.toHaveBeenCalled();

    elsewhere.focus();

    expect(onClose).toHaveBeenCalledTimes(1);
    elsewhere.remove();
  });

  it('is suspended while the caller has a dialog up', () => {
    const onClose = vi.fn();
    render(
      <Popover open onClose={onClose} label="Ana" suspendDismiss>
        <button type="button">Message Ana</button>
      </Popover>,
    );

    fireEvent.click(document.body);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
