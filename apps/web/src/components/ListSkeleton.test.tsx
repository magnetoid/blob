// @vitest-environment happy-dom
/**
 * A list still loading is drawn as its shape, and still says "Loading…" to the one
 * reader who cannot see a shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ListSkeleton, TileSkeleton } from './ListSkeleton.tsx';

afterEach(cleanup);

/** Every part that breathes stops for somebody who asked for less motion: a loop clamped
 *  to one run, which is all the global policy in base.css does, still ends on a flash. */
function stopsForReducedMotion(container: HTMLElement) {
  const pulsing = [...container.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')].filter(
    (part) => part.classList.contains('animate-pulse'),
  );
  expect(pulsing.length).toBeGreaterThan(0);
  for (const part of pulsing) {
    expect(part.classList.contains('motion-reduce:animate-none')).toBe(true);
  }
}

describe('a list that has not arrived', () => {
  it('is rows of lines, marked busy, and says what it means in words', () => {
    const { container } = render(<ListSkeleton />);
    const skeleton = container.querySelector('.message-skeleton')!;
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(container.querySelectorAll('.message-skeleton-row')).toHaveLength(5);
    // The rows are decoration: nothing in them reaches the accessibility tree.
    for (const row of container.querySelectorAll('.message-skeleton-row')) {
      expect(row.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it("draws its avatars and lines with shadcn's Skeleton", () => {
    const { container } = render(<ListSkeleton />);
    for (const row of container.querySelectorAll('.message-skeleton-row')) {
      const parts = row.querySelectorAll('[data-slot="skeleton"]');
      // An avatar, a name and a line of a message.
      expect(parts).toHaveLength(3);
    }
    expect(container.querySelectorAll('.message-skeleton-line')).toHaveLength(10);
    for (const line of container.querySelectorAll('.message-skeleton-line')) {
      expect(line.getAttribute('data-slot')).toBe('skeleton');
    }
  });

  it('gives each row a message of a different length', () => {
    // Five rows stamped from one would read as one flashing block rather than as content.
    const { container } = render(<ListSkeleton />);
    const second = [...container.querySelectorAll('.message-skeleton-row')].map(
      (row) => row.querySelectorAll('.message-skeleton-line')[1]!.className,
    );
    expect(new Set(second).size).toBe(5);
  });

  it('stops breathing for reduced motion', () => {
    stopsForReducedMotion(render(<ListSkeleton />).container);
  });

  it('draws fewer rows for a small card, and no avatars where a row has none', () => {
    const { container } = render(<ListSkeleton rows={2} avatar="none" />);
    expect(container.querySelectorAll('.message-skeleton-row')).toHaveLength(2);
    expect(container.querySelector('.message-skeleton-avatar')).toBeNull();
  });

  it('draws the avatar at the size the real rows do', () => {
    // A pinned row's avatar is 20px; a 36px placeholder shrank under the real one.
    const { container } = render(<ListSkeleton avatar="sm" />);
    const avatars = [...container.querySelectorAll('.message-skeleton-avatar')];
    expect(avatars).toHaveLength(5);
    expect(avatars.every((avatar) => avatar.getAttribute('data-size') === 'sm')).toBe(true);
    expect(avatars.every((avatar) => avatar.getAttribute('data-slot') === 'skeleton')).toBe(true);
  });
});

describe('a grid of files that has not arrived', () => {
  it('is the grid itself with squares in it, and says what it means in words', () => {
    // Rows of lines snapped into a grid of tiles; the placeholder is the grid's shape.
    const { container } = render(<TileSkeleton tiles={6} />);
    const grid = container.querySelector('.files-grid')!;
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(grid.querySelectorAll('.files-tile-skeleton')).toHaveLength(6);
    for (const tile of grid.querySelectorAll('.files-tile-skeleton')) {
      expect(tile.getAttribute('data-slot')).toBe('skeleton');
      expect(tile.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('stops breathing for reduced motion', () => {
    stopsForReducedMotion(render(<TileSkeleton tiles={6} />).container);
  });
});
