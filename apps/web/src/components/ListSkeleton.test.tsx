// @vitest-environment happy-dom
/**
 * A list still loading is drawn as its shape, and still says "Loading…" to the one
 * reader who cannot see a shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ListSkeleton, TileSkeleton } from './ListSkeleton.tsx';

afterEach(cleanup);

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
  });
});

describe('a grid of files that has not arrived', () => {
  it('is the grid itself with squares in it, and says what it means in words', () => {
    // Rows of lines snapped into a grid of tiles; the placeholder is the grid's shape.
    const { container } = render(<TileSkeleton tiles={6} />);
    const grid = container.querySelector('.files-grid')!;
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(grid.querySelectorAll('.files-tile-skeleton')).toHaveLength(6);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });
});
