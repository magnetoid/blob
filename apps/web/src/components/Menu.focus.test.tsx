// @vitest-environment happy-dom
/**
 * Where a menu puts focus as it opens, and that it moves it there without scrolling.
 *
 * Focus goes to the first item a menu has, as Base UI would choose it, and on the frame it
 * goes the panel can still be where Base UI put it before the panel's own stylesheet was
 * read — below its trigger. For the schedule menu, which hangs *above* the composer's clock,
 * that spot is off the bottom of the page, and a focus that scrolls brought it into view by
 * scrolling whatever clips the page: the whole shell moved up and stayed there. The
 * positioner brings a panel into view; focus never scrolls to it.
 *
 * Its own file, so `Menu.test.tsx` and `Menu.chunk.test.tsx` stay as Task 3 left them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Menu } from './Menu.tsx';
import '../test/overlayChunk.ts';

afterEach(cleanup);

describe('a menu opening', () => {
  it('takes focus to its first item, without scrolling anything to it', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    render(
      <Menu open onClose={vi.fn()} className="menu">
        <p>Send later</p>
        <button role="menuitem" type="button" disabled>
          In 20 minutes
        </button>
        <button role="menuitem" type="button">
          Tomorrow at 9:00
        </button>
        <select aria-label="Repeat">
          <option>Once</option>
        </select>
      </Menu>,
    );

    // The first item that can take focus: a disabled one cannot.
    const first = screen.getByRole('menuitem', { name: 'Tomorrow at 9:00' });
    await waitFor(() => expect(document.activeElement).toBe(first));
    const options = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === first).map(([o]) => o);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o).toEqual({ preventScroll: true });

    focus.mockRestore();
    trigger.remove();
  });
});
