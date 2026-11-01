// @vitest-environment happy-dom
/**
 * Blob's dialog, standing on shadcn's.
 *
 * The overlay chunk is already here in every test (`src/test/overlayChunk.ts`), as it
 * normally is in the app by the time anybody opens a dialog, so each case below draws its
 * dialog in the render that opened it. What Base UI does a frame later — move focus in, finish an exit —
 * the cases that care wait for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPresence } from './Dialog.tsx';
import { useEscape } from '../lib/useEscape.ts';
import '../test/overlayChunk.ts';

afterEach(cleanup);

/** Escape as the browser sends it: to whatever has focus. */
function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

const dialogs = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')];
const dialog = () => dialogs()[0] ?? null;
const backdrop = () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');

function renderDialog(onClose = vi.fn(), className?: string) {
  const view = render(
    <Dialog label="Archive #general?" onClose={onClose} className={className}>
      <div className="dialog">
        <p>It stays searchable.</p>
        <button type="button">Archive</button>
      </div>
    </Dialog>,
  );
  return { onClose, ...view };
}

describe('Dialog', () => {
  it('is a modal dialog with the name it was given', () => {
    const { container } = renderDialog();
    const node = screen.getByRole('dialog', { name: 'Archive #general?' });
    expect(node).toBe(dialog());
    // Portalled out of the tree that rendered it, so a dialog opened from inside a
    // transformed, virtualised row is not trapped in that row — and the page behind it is
    // hidden from assistive tech while it asks.
    expect(container.contains(node)).toBe(false);
    expect(container.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the body it was given a legacy island', () => {
    // The feature's own markup predates Tailwind and is styled by the legacy CSS, which
    // stops at shadcn's `data-slot` unless an island says otherwise (styles/app/base.css).
    renderDialog();
    const island = screen.getByText('It stays searchable.').closest('[data-legacy]');
    expect(island).not.toBeNull();
    expect(dialog()?.contains(island)).toBe(true);
  });

  it('closes on Escape', () => {
    const { onClose } = renderDialog();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click that lands on the backdrop, and not on one inside', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByText('It stays searchable.'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once, however many ways it was asked', () => {
    const { onClose } = renderDialog();
    fireEvent.click(backdrop()!);
    pressEscape();
    fireEvent.click(backdrop()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts focus back where it came from', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <Dialog label="A question" onClose={() => {}}>
        <div className="dialog">
          <button type="button">Yes</button>
        </div>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Yes')));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('gives a variant’s host class to the element that holds its backdrop and panel', () => {
    // `lightbox-host` darkens its own backdrop and lets the picture use more of the screen;
    // `palette-host` sits high. Both are custom properties set on the host.
    renderDialog(vi.fn(), 'lightbox-host');
    const host = backdrop()!.parentElement!;
    expect(host.classList.contains('lightbox-host')).toBe(true);
    expect(host.contains(dialog())).toBe(true);
  });

  it('holds the key above whatever was open before it', () => {
    // A panel or a legacy menu under the dialog keeps its place on the shared stack but
    // does not hear the Escape that closes the dialog.
    const underneath = vi.fn();
    function Underneath() {
      useEscape(underneath);
      return null;
    }
    render(<Underneath />);
    const { onClose } = renderDialog();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
  });

  it('lets nothing behind it hear the Escape that ends a composition, in Safari’s order', async () => {
    // Safari fires `compositionend` before `keydown`, so the Escape that dismisses an input
    // method's candidates arrives saying `isComposing: false`. Base UI still knows it
    // belongs to the input method and leaves the dialog open — and the shell behind must
    // leave it too, or it closes the thread under the dialog or marks the channel read.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    try {
      const onClose = vi.fn();
      render(
        <Dialog label="Send feedback" onClose={onClose}>
          <form className="dialog">
            <input aria-label="Summary" />
          </form>
        </Dialog>,
      );
      const field = screen.getByLabelText('Summary');
      field.focus();

      fireEvent.compositionStart(field);
      fireEvent.compositionEnd(field);
      fireEvent.keyDown(field, { key: 'Escape', isComposing: false });

      expect(onClose).not.toHaveBeenCalled();
      expect(shell).not.toHaveBeenCalled();

      // Once the input method has let go, Escape is the dialog's again — once.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(shell).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', shell);
    }
  });

  it('does not let the Escape it answers reach the shell', () => {
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    try {
      const { onClose } = renderDialog();
      pressEscape();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(shell).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', shell);
    }
  });
});

/**
 * A dialog that leaves as well as arrives.
 *
 * The contract is that nothing about *opening* changes: the dialog mounts on the render
 * that opens it — the chunk being here — so its autofocus and on-mount request fire when
 * `{open && <X/>}` fired them. Only the close is different: held for Base UI's exit, then
 * gone.
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
          <button type="button">Done</button>
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

  it('renders nothing, and runs nothing, until it is opened', () => {
    const mounted = vi.fn();
    render(<Harness mounted={mounted} />);
    expect(dialog()).toBeNull();
    expect(mounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('open'));
    expect(screen.getByRole('dialog', { name: 'About #general' })).toBe(dialog());
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('lets what it opened reach into its own body as it mounts', () => {
    // The pattern every form here uses: `useEffect(() => ref.current?.focus(), [])` in the
    // component that renders <Dialog>. Base UI draws a portal's contents a render or two
    // after the portal itself, so that component has to sit inside the dialog for its body
    // to be there when its effect runs. Focus on Summary rather than on the first chip is
    // the difference somebody would notice.
    function Feedback({ onClose }: { onClose: () => void }) {
      const summary = useRef<HTMLInputElement>(null);
      useEffect(() => summary.current?.focus(), []);
      return (
        <Dialog label="Send feedback" onClose={onClose}>
          <form className="dialog">
            <button type="button">Bug</button>
            <input ref={summary} aria-label="Summary" />
          </form>
        </Dialog>
      );
    }
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            feedback
          </button>
          <DialogPresence when={open}>{() => <Feedback onClose={() => setOpen(false)} />}</DialogPresence>
        </>
      );
    }
    render(<Opener />);
    fireEvent.click(screen.getByText('feedback'));
    expect(document.activeElement).toBe(screen.getByLabelText('Summary'));
  });

  it('keeps the thing it was opened for while it leaves', async () => {
    // The caller's state is null by now; a dialog redrawn from null would empty itself
    // in the middle of fading out.
    render(<Harness mounted={vi.fn()} />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));

    expect(dialog()?.hasAttribute('data-closed')).toBe(true);
    expect(screen.getByText('#general')).toBeTruthy();

    // And it goes once Base UI says the exit is over.
    await waitFor(() => expect(dialog()).toBeNull());
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

    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
    expect(dialog()?.hasAttribute('data-closed')).toBe(true);

    pressEscape();
    expect(underneath).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('closes one layer per Escape when a dialog opens another', async () => {
    function Inner({ onClose }: { onClose: () => void }) {
      return (
        <Dialog label="Inner" onClose={onClose}>
          <div className="dialog">
            <button type="button">inner</button>
          </div>
        </Dialog>
      );
    }
    function Outer({ onClose }: { onClose: () => void }) {
      const [inner, setInner] = useState(false);
      return (
        <Dialog label="Outer" onClose={onClose}>
          <div className="dialog">
            <button type="button" onClick={() => setInner(true)}>
              more
            </button>
            <DialogPresence when={inner}>{() => <Inner onClose={() => setInner(false)} />}</DialogPresence>
          </div>
        </Dialog>
      );
    }
    const closeOuter = vi.fn();
    render(<Outer onClose={closeOuter} />);
    fireEvent.click(screen.getByText('more'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('inner')));

    pressEscape();
    expect(closeOuter).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('inner')).toBeNull());

    pressEscape();
    expect(closeOuter).toHaveBeenCalledTimes(1);
  });

  it('closes one layer per Escape when two were opened apart and focus is in neither', async () => {
    // "Confirm it’s you" asked over New channel is a dialog of its own, not one nested in
    // it. With focus left on the page's body — the field it was in went away — nothing
    // inside the top one was there to stop the key, and Base UI's listener on `document`
    // in each closed both.
    function Closable({ label, onClose }: { label: string; onClose: () => void }) {
      const [open, setOpen] = useState(true);
      return (
        <DialogPresence when={open}>
          {() => (
            <Dialog
              label={label}
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            >
              <div className="dialog">
                <button type="button">{label}</button>
              </div>
            </Dialog>
          )}
        </DialogPresence>
      );
    }
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    render(
      <>
        <Closable label="New channel" onClose={closeFirst} />
        <Closable label="Confirm it’s you" onClose={closeSecond} />
      </>,
    );
    await waitFor(() => expect(dialogs()).toHaveLength(2));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    pressEscape();
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();

    pressEscape();
    expect(closeFirst).toHaveBeenCalledTimes(1);
  });

  it('leaves an Escape from inside it to what is inside it', async () => {
    // The layer answers only a key from outside the popup. One from a field in it goes
    // the whole way down — a field with an Escape of its own still hears it — and Base
    // UI closes the dialog from there.
    const fieldHeard = vi.fn();
    const onClose = vi.fn();
    render(
      <Dialog label="Rename" onClose={onClose}>
        <div className="dialog">
          <input aria-label="Name" onKeyDown={(event) => event.key === 'Escape' && fieldHeard()} />
        </div>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));

    pressEscape();
    expect(fieldHeard).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
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
    expect(dialogs()).toHaveLength(1);
    expect(dialog()).not.toBe(first);
    expect(dialog()?.hasAttribute('data-open')).toBe(true);

    // And it closes, which a revived one would not.
    pressEscape();
    expect(dialog()?.hasAttribute('data-closed')).toBe(true);
  });

  it('gives focus back to its opener as the exit begins, not when it ends', async () => {
    render(<Harness mounted={vi.fn()} />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Done')));

    pressEscape();

    // Still drawn, leaving, and nothing in it can be reached — but focus is home already.
    expect(dialog()?.hasAttribute('data-closed')).toBe(true);
    expect(dialog()?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('does not take focus back from wherever it went during the exit', async () => {
    // Somebody who clicked into the composer while the dialog faded is typing there; the
    // unmount a moment later must not pull them back to the button that opened it.
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    try {
      render(<Harness mounted={vi.fn()} />);
      const opener = screen.getByText('open');
      opener.focus();
      fireEvent.click(opener);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Done')));
      pressEscape();
      expect(document.activeElement).toBe(opener);

      composer.focus();
      await waitFor(() => expect(dialog()).toBeNull());
      expect(document.activeElement).toBe(composer);
    } finally {
      composer.remove();
    }
  });
});
