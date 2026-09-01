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
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Toasts } from './Toasts.tsx';
import { useToasts } from '../lib/toasts.ts';

afterEach(() => {
  cleanup();
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
    // Otherwise the next failure recreates it and is silent again.
    const { container } = render(<Toasts />);
    act(() => {
      useToasts.getState().push('error', 'first');
    });
    const id = useToasts.getState().toasts[0]!.id;

    act(() => {
      useToasts.getState().dismiss(id);
    });

    expect(container.querySelector('.toast-stack')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
