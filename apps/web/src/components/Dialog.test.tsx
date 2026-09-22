// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { Dialog, DialogPresence } from './Dialog.tsx';
import { FALLBACK_MS } from '../lib/usePresence.ts';
import { useEscape } from '../lib/useEscape.ts';

afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <Dialog label="Archive #general?" onClose={onClose}>
      <div className="dialog">
        <p>It stays searchable.</p>
        <button type="button">Archive</button>
      </div>
    </Dialog>,
  );
  return onClose;
}

describe('Dialog', () => {
  it('is a modal dialog with the name it was given', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Archive #general?' }) as HTMLDialogElement;
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
  });

  it('closes on Escape, through the stack every overlay shares', () => {
    const onClose = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click that lands on the backdrop, and not on one inside', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByText('It stays searchable.'));
    expect(onClose).not.toHaveBeenCalled();
    // Clicks on `::backdrop` are delivered to the dialog element itself; the content
    // wrapper fills the element, so a click whose target is the element is on the backdrop.
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once, however many ways it was asked', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts focus back where it came from', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(
      <Dialog label="A question" onClose={() => {}}>
        <div className="dialog">
          <button type="button">Yes</button>
        </div>
      </Dialog>,
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

/**
 * A dialog that leaves as well as arrives.
 *
 * The contract is that nothing about *opening* changes: the dialog mounts on the render
 * that opens it, so its focus trap, autofocus and on-mount request fire exactly when
 * `{open && <X/>}` fired them. Only the close is different — held for one exit, then gone.
 */
describe('DialogPresence', () => {
  /** A dialog with on-mount work, as CatchUpPanel's request is: counts every mount. */
  function Probe({ name, onClose, mounted }: { name: string; onClose: () => void; mounted: () => void }) {
    useEffect(() => {
      mounted();
    }, [mounted]);
    return (
      <Dialog label={`About ${name}`} onClose={onClose}>
        <div className="dialog">
          <p>{name}</p>
        </div>
      </Dialog>
    );
  }

  function Harness({ mounted, onEscape }: { mounted: () => void; onEscape?: () => void }) {
    const [subject, setSubject] = useState<string | null>(null);
    return (
      <>
        <button type="button" onClick={() => setSubject('#general')}>
          open
        </button>
        <button type="button" onClick={() => setSubject(null)}>
          close
        </button>
        <DialogPresence when={subject}>
          {(name) => (
            <Probe
              name={name}
              mounted={mounted}
              onClose={() => {
                onEscape?.();
                setSubject(null);
              }}
            />
          )}
        </DialogPresence>
      </>
    );
  }

  const dialog = () => document.querySelector('dialog');

  it('renders nothing, and runs nothing, until it is opened', () => {
    const mounted = vi.fn();
    render(<Harness mounted={mounted} />);
    expect(dialog()).toBeNull();
    expect(mounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('open'));
    expect(dialog()?.open).toBe(true);
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('stays modal, inert and closed-for-the-stylesheet until its own exit ends', () => {
    render(<Harness mounted={vi.fn()} />);
    fireEvent.click(screen.getByText('open'));
    const node = dialog()!;
    expect(node.getAttribute('data-state')).toBe('open');
    expect(node.hasAttribute('inert')).toBe(false);

    fireEvent.click(screen.getByText('close'));
    // The same element: held, not re-rendered into a new one.
    expect(dialog()).toBe(node);
    expect(node.open).toBe(true);
    expect(node.getAttribute('data-state')).toBe('closed');
    expect(node.hasAttribute('inert')).toBe(true);

    // An animation ending inside it — the panel's own entrance, a reaction chip — is not
    // the end of the exit.
    act(() => {
      node.querySelector('p')!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(dialog()).toBe(node);

    act(() => {
      node.dispatchEvent(new Event('animationend'));
    });
    expect(dialog()).toBeNull();
  });

  it('keeps the thing it was opened for while it leaves', () => {
    // The caller's state is null by now; a dialog redrawn from null would empty itself
    // in the middle of fading out.
    render(<Harness mounted={vi.fn()} />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));
    expect(dialog()?.getAttribute('data-state')).toBe('closed');
    expect(screen.getByText('#general')).toBeTruthy();
  });

  it('stops answering Escape the moment it starts to leave', () => {
    // A second press belongs to whatever is underneath — here an overlay that was open
    // before the dialog — and not to a dialog that has already been answered, which
    // would swallow it.
    const underneath = vi.fn();
    function Underneath() {
      useEscape(underneath);
      return null;
    }
    const onEscape = vi.fn();
    render(
      <>
        <Underneath />
        <Harness mounted={vi.fn()} onEscape={onEscape} />
      </>,
    );
    fireEvent.click(screen.getByText('open'));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
    expect(dialog()?.getAttribute('data-state')).toBe('closed');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(underneath).toHaveBeenCalledTimes(1);
  });

  it('mounts a new dialog when it is reopened before the old one has gone', () => {
    // The old one has been answered and will not close again; the new one must focus and
    // fetch exactly as a first opening would.
    const mounted = vi.fn();
    render(<Harness mounted={mounted} />);
    fireEvent.click(screen.getByText('open'));
    const first = dialog();
    fireEvent.click(screen.getByText('close'));
    fireEvent.click(screen.getByText('open'));

    expect(mounted).toHaveBeenCalledTimes(2);
    expect(dialog()).not.toBe(first);
    expect(dialog()?.getAttribute('data-state')).toBe('open');

    // And it closes, which a revived one would not.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()?.getAttribute('data-state')).toBe('closed');
  });

  it('without popovers, stays modal through the exit and hands focus back as it goes', () => {
    // happy-dom has no popover API, which is the case `letGo` falls back on: the dialog
    // keeps the page inert for the 150ms, and focus goes home on unmount as it always did.
    render(<Harness mounted={vi.fn()} />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    const node = dialog()!;
    expect(document.activeElement).not.toBe(opener);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(node.open).toBe(true);
    expect(node.hasAttribute('popover')).toBe(false);

    act(() => {
      node.dispatchEvent(new Event('animationend'));
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('lets go on the fallback when no animation ever ends', () => {
    vi.useFakeTimers();
    try {
      render(<Harness mounted={vi.fn()} />);
      fireEvent.click(screen.getByText('open'));
      fireEvent.click(screen.getByText('close'));
      expect(dialog()).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(FALLBACK_MS);
      });
      expect(dialog()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Where the browser has popovers — every current one — a leaving dialog stops being
   * modal the moment its exit starts, so focus is home and the page takes keys and
   * clicks again while it fades. happy-dom has no popover API, so `showPopover` is
   * stood in for here; what is under test is the order of things, not the platform.
   */
  describe('with popovers', () => {
    const shown: Element[] = [];
    beforeEach(() => {
      shown.length = 0;
      HTMLElement.prototype.showPopover = function (this: HTMLElement) {
        shown.push(this);
      };
    });
    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    });

    it('gives focus back to its opener as the exit begins, not when it ends', () => {
      render(<Harness mounted={vi.fn()} />);
      const opener = screen.getByText('open');
      opener.focus();
      fireEvent.click(opener);
      const node = dialog()!;

      fireEvent.keyDown(window, { key: 'Escape' });

      // Closed — so nothing behind it is inert any more — and straight back on screen
      // as a manual popover, still held for its exit.
      expect(node.open).toBe(false);
      expect(node.getAttribute('popover')).toBe('manual');
      expect(shown).toEqual([node]);
      expect(dialog()).toBe(node);
      expect(node.getAttribute('data-state')).toBe('closed');
      expect(node.hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(opener);
    });

    it('does not take focus back from wherever it went during the exit', () => {
      // Somebody who clicked into the composer while the dialog faded is typing there;
      // the unmount 150ms later must not pull them back to the button that opened it.
      const composer = document.createElement('textarea');
      document.body.appendChild(composer);
      try {
        render(<Harness mounted={vi.fn()} />);
        const opener = screen.getByText('open');
        opener.focus();
        fireEvent.click(opener);
        const node = dialog()!;
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(document.activeElement).toBe(opener);

        composer.focus();
        act(() => {
          node.dispatchEvent(new Event('animationend'));
        });

        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(composer);
      } finally {
        composer.remove();
      }
    });
  });
});
