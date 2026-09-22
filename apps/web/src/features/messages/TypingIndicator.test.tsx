// @vitest-environment happy-dom
/**
 * "Ana is typing…" arrives and leaves rather than cutting in and out — and leaves still
 * saying who it was about, because the names are gone before its exit starts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { TypingIndicator } from './TypingIndicator.tsx';

afterEach(cleanup);

const line = () => document.querySelector<HTMLElement>('.typing-dots');

describe('the typing line', () => {
  it('is not there while nobody is typing', () => {
    render(<TypingIndicator names={[]} />);
    expect(line()).toBeNull();
  });

  it('says who, in the sentence it has always used', () => {
    const { rerender } = render(<TypingIndicator names={['Ana']} />);
    expect(screen.getByText('Ana is typing…')).toBeTruthy();

    rerender(<TypingIndicator names={['Ana', 'Bo']} />);
    expect(screen.getByText('Ana and Bo are typing…')).toBeTruthy();

    rerender(<TypingIndicator names={['Ana', 'Bo', 'Cy']} />);
    expect(screen.getByText('Several people are typing…')).toBeTruthy();
  });

  it('leaves holding its last sentence, inert, until its own exit ends', () => {
    const { rerender } = render(<TypingIndicator names={['Ana']} />);
    const node = line()!;
    expect(node.dataset.state).toBe('open');

    rerender(<TypingIndicator names={[]} />);
    expect(line()).toBe(node);
    expect(node.dataset.state).toBe('closed');
    expect(node.hasAttribute('inert')).toBe(true);
    expect(node.textContent).toBe('Ana is typing…');

    act(() => {
      node.dispatchEvent(new Event('animationend'));
    });
    expect(line()).toBeNull();
  });
});
