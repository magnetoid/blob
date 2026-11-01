// @vitest-environment happy-dom
/** "Link copied" arrives, and then leaves the way it came instead of cutting out. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Confirmation } from './Confirmation.tsx';

afterEach(cleanup);

describe('a confirmation', () => {
  it('is drawn only once there is something to confirm', () => {
    render(
      <Confirmation show={false} className="copied-note">
        Link copied
      </Confirmation>,
    );
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('keeps its own class and attributes beside the motion', () => {
    render(
      <Confirmation show className="copied-note" role="status">
        Link copied
      </Confirmation>,
    );
    const note = screen.getByRole('status');
    expect(note.classList.contains('copied-note')).toBe(true);
    expect(note.dataset.state).toBe('open');
  });

  it('wears shadcn’s muted note, and moves by the motion tokens', () => {
    // Its look and its motion are Tailwind utilities now rather than `.confirmation` in the
    // legacy sheet: a muted word on a muted ground, in by `chip-in` and out by
    // `overlay-out`, which travel only by the tokens reduced motion zeroes.
    render(<Confirmation show>Link copied</Confirmation>);
    const note = screen.getByText('Link copied');

    expect(note.classList).toContain('bg-muted');
    expect(note.classList).toContain('text-muted-foreground');
    expect(note.className).toMatch(/animate-\[chip-in_/);
    expect(note.className).toMatch(/data-\[state=closed\]:animate-\[overlay-out_/);
  });

  it('stays through its exit, inert, and goes when that ends', () => {
    const { rerender } = render(
      <Confirmation show className="copied-note">
        Link copied
      </Confirmation>,
    );
    const note = screen.getByText('Link copied');

    rerender(
      <Confirmation show={false} className="copied-note">
        Link copied
      </Confirmation>,
    );
    expect(screen.getByText('Link copied')).toBe(note);
    expect(note.dataset.state).toBe('closed');
    expect(note.hasAttribute('inert')).toBe(true);

    act(() => {
      note.dispatchEvent(new Event('animationend'));
    });
    expect(screen.queryByText('Link copied')).toBeNull();
  });
});
