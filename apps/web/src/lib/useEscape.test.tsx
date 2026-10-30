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
import { useEscape, useEscapeLayer } from './useEscape.ts';

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

  it('cancels the browser’s own answer to the key once it has answered it', () => {
    // After every handler, the browser turns an Escape into a close request for whichever
    // modal dialog is on top at that moment. A dialog that has just started leaving is no
    // longer modal, so that request went to the dialog *under* it: one Escape over Help
    // closed Feedback too, and the draft in it. happy-dom has no close requests, so what
    // can be held here is the flag the browser reads.
    render(<Dialog onClose={vi.fn()} />);

    const handled = fireEvent.keyDown(window, { key: 'Escape' });

    // `fireEvent` returns false for an event whose default was prevented.
    expect(handled).toBe(false);
  });

  it('leaves the browser’s answer alone when nothing here took the key', () => {
    const handled = fireEvent.keyDown(window, { key: 'Escape' });
    expect(handled).toBe(true);
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

/**
 * A Base UI dialog closes on Escape itself, with a listener on `document` that stops the
 * key once it has answered it. On the stack it is a layer that holds the top — so nothing
 * opened before it hears the key — and lets the key through to its own listener.
 */
describe('an overlay that answers Escape itself', () => {
  /** Stands in for Base UI's own listener: answers, and stops the key there. */
  function ownListener() {
    const answered = vi.fn((event: KeyboardEvent) => event.stopPropagation());
    document.addEventListener('keydown', answered);
    return { answered, remove: () => document.removeEventListener('keydown', answered) };
  }

  function Layer() {
    useEscapeLayer();
    return null;
  }

  it('holds the top of the stack, so nothing under it hears the key', () => {
    const own = ownListener();
    const underneath = vi.fn();
    try {
      render(<Dialog onClose={underneath} />);
      render(<Layer />);

      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(own.answered).toHaveBeenCalledTimes(1);
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      own.remove();
    }
  });

  it('leaves the key untouched for its own listener', () => {
    // Not stopped, not default-prevented: whether to close, and how, is the overlay's.
    const seen: { defaultPrevented: boolean }[] = [];
    const own = vi.fn((event: KeyboardEvent) => seen.push({ defaultPrevented: event.defaultPrevented }));
    document.addEventListener('keydown', own);
    try {
      render(<Layer />);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(own).toHaveBeenCalledTimes(1);
      expect(seen[0]?.defaultPrevented).toBe(false);
    } finally {
      document.removeEventListener('keydown', own);
    }
  });

  it('hands the key back to what is underneath once it is gone', () => {
    const underneath = vi.fn();
    render(<Dialog onClose={underneath} />);
    const layer = render(<Layer />);
    layer.unmount();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(underneath).toHaveBeenCalledTimes(1);
  });

  it('lets nobody act on an Escape that only ends a composition', () => {
    // Base UI leaves that key alone — it belongs to the input method — so nothing would
    // stop it reaching the shell, which would close the thread or mark the channel read.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    const underneath = vi.fn();
    try {
      render(<Dialog onClose={underneath} />);
      render(<Layer />);
      fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
      expect(shell).not.toHaveBeenCalled();
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', shell);
    }
  });
});
