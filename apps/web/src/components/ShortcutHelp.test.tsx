// @vitest-environment happy-dom
/** ⌘/ shows the keys. The keys are not the whole question.
 *
 * The dialog is generated from `SHORTCUTS`, which is what keeps it honest — and also
 * what limits it: somebody who presses ⌘/ wanting to know how threads work gets a list
 * of chords and no way onward. The link is that way onward, and it has to close the
 * dialog before it navigates or the guide arrives underneath a modal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutHelp } from './ShortcutHelp.tsx';
import { SHORTCUTS } from '../lib/shortcuts.ts';

afterEach(cleanup);

describe('the shortcut dialog', () => {
  it('lists every binding there is', () => {
    render(<ShortcutHelp onClose={vi.fn()} />);

    for (const shortcut of SHORTCUTS) {
      expect(screen.getByText(shortcut.label)).toBeTruthy();
    }
  });

  it('offers the guide, and closes itself on the way there', () => {
    const onClose = vi.fn();
    render(<ShortcutHelp onClose={onClose} />);

    fireEvent.click(screen.getByText(/how Blob works/i));

    expect(onClose).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/help');
  });
});
