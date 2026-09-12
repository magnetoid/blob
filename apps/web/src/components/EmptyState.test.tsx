// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState.tsx';

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
