// @vitest-environment happy-dom
/** Escape belongs to the thing on top.
 *
 * Two of the four dialogs bound no Escape listener at all while carrying a comment
 * saying they did, so the key fell through to the shell — which closed the thread panel
 * behind the still-open dialog, or, with nothing left to close, marked the channel read
 * and destroyed a mark-unread that had just been set.
 *
 * The two that *did* bind one had a quieter version of the same problem: the shell
 * listens on `window` too and, having mounted first, its listener ran first. So the
 * phase is the part worth pinning, not merely the presence of a handler.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEscape } from './useEscape.ts';

afterEach(cleanup);

function Dialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return <div>a dialog</div>;
}

describe('a dialog’s Escape', () => {
  it('closes it', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not reach a shell handler registered before it', () => {
    // The ordering the app actually has: Workspace mounts first and listens on window,
    // so a bubble-phase listener in the dialog would run *second* and the shell would
    // already have marked the channel read.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
    window.removeEventListener('keydown', shell);
  });

  it('leaves every other key to whoever wants it', () => {
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'k' });

    expect(onClose).not.toHaveBeenCalled();
    expect(shell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', shell);
  });

  it('stops listening once the dialog is gone', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Dialog onClose={onClose} />);

    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the key to the shell when nothing is open', () => {
    // The shell's Escape is what marks a channel read. It has to keep working, and only
    // when there is nothing on top of it.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(shell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', shell);
  });
});

describe('two things open at once', () => {
  it('closes the one that opened last', () => {
    // A dialog opened from a menu. A flag rather than a stack would hand the key to
    // whichever claimed it first and leave the newer one unclosable.
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(<Dialog onClose={closeOuter} />);
    const inner = render(<Dialog onClose={closeInner} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();

    // And the one underneath answers once the newer one is gone.
    inner.unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeOuter).toHaveBeenCalledTimes(1);
  });

  it('and the shell hears neither', () => {
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    render(<Dialog onClose={vi.fn()} />);
    render(<Dialog onClose={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(shell).not.toHaveBeenCalled();
    window.removeEventListener('keydown', shell);
  });
});

describe('an overlay that is mounted but closed', () => {
  it('does not claim the key', () => {
    // `Menu` holds its panel through the exit animation; one on its way out must stop
    // answering the moment it is asked to close.
    const onClose = vi.fn();
    const shell = vi.fn();
    window.addEventListener('keydown', shell);

    function Closed() {
      useEscape(onClose, false);
      return null;
    }
    render(<Closed />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(shell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', shell);
  });
});
