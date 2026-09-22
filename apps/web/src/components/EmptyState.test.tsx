// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState.tsx';
import { navigate } from '../lib/router.ts';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders the title alone when that is all there is', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here').className).toBe('empty-state-title');
    expect(container.querySelector('.empty-state-body')).toBeNull();
    expect(container.querySelector('.empty-state-mark')).toBeNull();
  });

  it('keeps the mark out of the accessibility tree and the action after the body', () => {
    const { container } = render(
      <EmptyState mark="#" title="Start" action={<button type="button">Go</button>} aria-live="polite">
        Say hello.
      </EmptyState>,
    );
    const mark = container.querySelector('.empty-state-mark');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    const order = Array.from(container.querySelector('.empty-state')!.children).map((el) => el.className || el.tagName);
    expect(order).toEqual(['empty-state-mark', 'empty-state-title', 'empty-state-body', 'BUTTON']);
    expect(container.querySelector('.empty-state')?.getAttribute('aria-live')).toBe('polite');
  });
});

/**
 * An empty state arrives on the view the app opened onto and nowhere after: every later
 * one was switched to, and a switch stays instant. In order, because the first move is
 * one-way for the life of the page, as it is for the module under test.
 */
describe('an empty state arriving', () => {
  const arriving = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('.empty-state')!.dataset.arriving;

  it('arrives on the view the app opened onto', () => {
    const { container } = render(<EmptyState title="Nothing saved yet" />);
    expect(arriving(container)).toBe('true');
  });

  it('still does after the app rewrites its own address, which is not a move', () => {
    // What Workspace does on arrival — canonicalise the URL, open #general — and what a
    // search does per keystroke.
    navigate('/later', { replace: true });
    const { container } = render(<EmptyState title="Nothing saved yet" />);
    expect(arriving(container)).toBe('true');
  });

  it('just appears once somebody has gone somewhere', () => {
    navigate('/threads');
    const { container } = render(<EmptyState title="No threads yet" />);
    expect(arriving(container)).toBeUndefined();
  });
});
