// @vitest-environment happy-dom
/**
 * A count ticks when its number moves while you watch, in either direction, and sits
 * still when it is only being drawn.
 *
 * The tick is `count-tick` on a span keyed by the value, so a change is a new node and
 * the stylesheet keys the animation off `data-changed`. What these hold onto is exactly
 * that: which node, and whether it says it changed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Count } from './Count.tsx';

afterEach(cleanup);

const span = (container: HTMLElement) => container.querySelector('span')!;

describe('a count', () => {
  it('does not tick when it is first drawn', () => {
    const { container } = render(<Count value={3} />);
    expect(span(container).textContent).toBe('3');
    expect(span(container).dataset.changed).toBeUndefined();
  });

  it('ticks when the number goes up, and again when it comes back down', () => {
    // A reaction added and then taken back: the second change is as much news as the
    // first, and comparing against the number first drawn would have missed it.
    const { container, rerender } = render(<Count value={3} />);

    rerender(<Count value={4} />);
    const up = span(container);
    expect(up.textContent).toBe('4');
    expect(up.dataset.changed).toBe('true');

    rerender(<Count value={3} />);
    expect(span(container).textContent).toBe('3');
    expect(span(container)).not.toBe(up);
    expect(span(container).dataset.changed).toBe('true');
  });

  it('keeps its node for a render that did not change the number', () => {
    const { container, rerender } = render(<Count value={3} />);
    rerender(<Count value={4} />);
    const before = span(container);

    rerender(<Count value={4} />);
    expect(span(container)).toBe(before);
  });

  it('draws the phrase it is given', () => {
    const { container } = render(
      <Count value={1} format={(n) => `${n} ${n === 1 ? 'reply' : 'replies'}`} />,
    );
    expect(span(container).textContent).toBe('1 reply');
  });
});
