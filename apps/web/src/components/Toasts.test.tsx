// @vitest-environment happy-dom
/**
 * A live region has to be there before it has anything to say.
 *
 * `Toasts` returned null until the first toast, so the region and its text were created
 * in the same commit — and a region that arrives already full is commonly announced by
 * nothing at all. Toasts are how `showError` reports every failure in the app, so the one
 * channel for "that didn't work" was the one a screen reader could not hear.
 *
 * The empty stack costs nothing: it is `position: fixed` with `pointer-events: none`, and
 * measures 0×0 in a browser.
 *
 * The other half of the file is the exit: a dismissed toast is held in the DOM for one
 * animation instead of disappearing on the render that dismissed it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toasts } from './Toasts.tsx';
import { useToasts } from '../lib/toasts.ts';
import { FALLBACK_MS } from '../lib/usePresence.ts';

/** Past usePresence's fallback, which is what ends an exit here: happy-dom runs no
 *  animations, so the `animationend` a browser would send never comes. */
const EXIT_SETTLED_MS = FALLBACK_MS + 100;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    useToasts.setState({ toasts: [] });
  });
});

describe('the toast stack', () => {
  it('is in the document before there is anything to announce', () => {
    render(<Toasts />);

    const region = screen.getByRole('status');
    expect(region).toBeTruthy();
    expect(region.textContent).toBe('');
  });

  it('puts a new toast into that same region rather than a new one', () => {
    // The property that makes it audible: the element does not change identity, so the
    // message is a *change* to a region that was already being watched.
    const { container } = render(<Toasts />);
    const before = container.querySelector('.toast-stack');

    act(() => {
      useToasts.getState().push('error', 'that did not work');
    });

    const after = container.querySelector('.toast-stack');
    expect(after).toBe(before);
    expect(after!.textContent).toContain('that did not work');
  });

  it('keeps the region when the last toast is dismissed', () => {
    // Otherwise the next failure recreates it and is silent again. The toast itself is
    // now held for its exit, so the region empties when that finishes rather than on the
    // click — the region is what must not move, not its contents.
    vi.useFakeTimers();
    const { container } = render(<Toasts />);
    act(() => {
      useToasts.getState().push('error', 'first');
    });
    const id = useToasts.getState().toasts[0]!.id;

    act(() => {
      useToasts.getState().dismiss(id);
    });
    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLED_MS);
    });

    expect(container.querySelector('.toast-stack')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('holds a dismissed toast in the document for its exit, then lets it go', () => {
    // React drops a node on the render that stops returning it, which is why the toast
    // used to vanish: by the time it was out of the store there was nothing left to
    // animate. It stays, marked closed, and the stylesheet plays the exit off that.
    vi.useFakeTimers();
    render(<Toasts />);
    act(() => {
      useToasts.getState().push('error', 'that did not work');
    });
    const id = useToasts.getState().toasts[0]!.id;

    act(() => {
      useToasts.getState().dismiss(id);
    });

    const leaving = screen.getByText('that did not work').closest('.toast');
    expect(leaving).toBeTruthy();
    expect(leaving!.getAttribute('data-state')).toBe('closed');

    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLED_MS);
    });

    expect(screen.queryByText('that did not work')).toBeNull();
  });

  it('marks a toast that is still up as open', () => {
    // The enter keys off the same attribute the exit does; a toast with no state at all
    // would be a toast the CSS cannot tell apart from one on its way out.
    render(<Toasts />);
    act(() => {
      useToasts.getState().push('info', 'saved');
    });

    expect(screen.getByText('saved').closest('.toast')!.getAttribute('data-state')).toBe('open');
  });

  it('takes the dismiss button away the moment the toast starts leaving', () => {
    // The path a person actually takes, and the reason the button is not simply left in
    // place for the exit: `pointer-events: none` stops the pointer and nothing else, so
    // a leaving toast would still be in the tab order offering a control that dismisses
    // what is already dismissed. The text stays; only the control goes.
    vi.useFakeTimers();
    render(<Toasts />);
    act(() => {
      useToasts.getState().push('error', 'that did not work');
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    });

    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Dismiss notice' })).toBeNull();
    expect(screen.getByText('that did not work').closest('.toast')!.getAttribute('data-state')).toBe(
      'closed',
    );

    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLED_MS);
    });

    expect(screen.queryByText('that did not work')).toBeNull();
  });

  it('does not hold a toast whose text is pushed again while it is leaving', () => {
    // The store collapses a repeated failure into one notice. Holding the old one for
    // its exit could have broken that for 150ms, and audibly: `role="status"` is atomic,
    // so anything added to the region re-reads the whole of it and the same sentence
    // would be announced twice.
    vi.useFakeTimers();
    const { container } = render(<Toasts />);
    act(() => {
      useToasts.getState().push('error', 'that did not work');
    });
    const id = useToasts.getState().toasts[0]!.id;

    act(() => {
      useToasts.getState().dismiss(id);
    });
    act(() => {
      useToasts.getState().push('error', 'that did not work');
    });

    expect(screen.getAllByText('that did not work')).toHaveLength(1);
    expect(container.querySelectorAll('.toast')).toHaveLength(1);
    expect(container.querySelector('.toast')!.getAttribute('data-state')).toBe('open');
  });

  it('leaves a toast that is still up alone while another one goes', () => {
    // Two at once is the case the holding could break: the leaving one must not take the
    // live one with it, and must not shuffle past it on the way out.
    vi.useFakeTimers();
    const { container } = render(<Toasts />);
    act(() => {
      useToasts.getState().push('error', 'first');
      useToasts.getState().push('error', 'second');
    });
    const first = useToasts.getState().toasts[0]!.id;

    act(() => {
      useToasts.getState().dismiss(first);
    });

    const texts = () =>
      Array.from(container.querySelectorAll('.toast-text')).map((el) => el.textContent);
    expect(texts()).toEqual(['first', 'second']);

    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLED_MS);
    });

    expect(texts()).toEqual(['second']);
  });
});
