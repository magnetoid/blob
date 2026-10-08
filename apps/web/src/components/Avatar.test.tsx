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
  it('is the initial when there is no photo', () => {
    // One letter, as Meadow draws a person; two at the sidebar's 20px were a smudge.
    const { container } = render(<Avatar user={ANA} />);
    expect(container.querySelector('.avatar')!.textContent).toBe('A');
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps a whole character when a name starts with one outside the BMP', () => {
    // `name[0]` is half of a surrogate pair for an emoji, and renders as a box.
    const { container } = render(<Avatar user={{ displayName: '🦊 Fox', avatarUrl: null }} />);
    expect(container.querySelector('.avatar')!.textContent).toBe('🦊');
  });

  it('gives a person one tone wherever they appear, and not everyone the same one', () => {
    // Chosen from the name, so a reaction or a search hit — which hold no id — still
    // matches the sidebar. Across a handful of names both tones turn up, or the choice
    // would be decoration that never varies.
    const toneOf = (displayName: string) => {
      const { container } = render(<Avatar user={{ displayName, avatarUrl: null }} />);
      const value = container.querySelector('.avatar')!.getAttribute('data-tone');
      cleanup();
      return value;
    };
    expect(toneOf('Ana Lima')).toBe(toneOf('Ana Lima'));
    const tones = new Set(
      ['Ana Petrov', 'Marko Ilic', 'Devin Cole', 'Priya Raman', 'Ana Lima'].map(toneOf),
    );
    expect(tones).toEqual(new Set(['clay', 'sage']));
  });

  it('keeps the initials under a photo until the photo has loaded', () => {
    // A photo that never loads used to leave an empty square; now it leaves the letters.
    const { container } = render(<Avatar user={PHOTO} />);
    const image = container.querySelector('img')!;
    const initials = container.querySelector<HTMLElement>('.avatar-initials')!;

    expect(initials.textContent).toBe('A');
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
