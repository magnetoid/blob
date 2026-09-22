// @vitest-environment happy-dom
/**
 * A photo fades in over the initials once it has loaded, and never makes anybody wait
 * for one the browser already has.
 *
 * The attribute the stylesheet keys off is written onto the image directly — by its ref
 * for a cached one, by `load` for one that had to be fetched — so these read the DOM,
 * the way the stylesheet does. happy-dom loads no images, so `load` is fired by hand and
 * a cached image is one whose `complete` is made true.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Avatar } from './Avatar.tsx';

afterEach(cleanup);

const ANA = { displayName: 'Ana Lima', avatarUrl: null };
const PHOTO = { displayName: 'Ana Lima', avatarUrl: '/files/ana.png' };

describe('an avatar', () => {
  it('is the initials when there is no photo', () => {
    const { container } = render(<Avatar user={ANA} />);
    expect(container.querySelector('.avatar')!.textContent).toBe('AL');
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the initials under a photo until the photo has loaded', () => {
    // A photo that never loads used to leave an empty square; now it leaves the letters.
    const { container } = render(<Avatar user={PHOTO} />);
    const image = container.querySelector('img')!;
    const initials = container.querySelector<HTMLElement>('.avatar-initials')!;

    expect(initials.textContent).toBe('AL');
    // Decoration while the photo is there: the name is the avatar's title, as before.
    expect(initials.getAttribute('aria-hidden')).toBe('true');
    expect(image.dataset.loaded).toBeUndefined();

    fireEvent.load(image);
    expect(image.dataset.loaded).toBe('true');
  });

  it('shows a photo the browser already holds at once, without fading it', () => {
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const naturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'naturalWidth',
    );
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 64,
    });
    try {
      const { container } = render(<Avatar user={PHOTO} />);
      const image = container.querySelector('img')!;
      expect(image.dataset.loaded).toBe('cached');

      // The load event that follows does not turn it back into a fade.
      fireEvent.load(image);
      expect(image.dataset.loaded).toBe('cached');
    } finally {
      if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
      if (naturalWidth) {
        Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', naturalWidth);
      }
    }
  });
});
