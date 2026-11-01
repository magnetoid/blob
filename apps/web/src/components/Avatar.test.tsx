// @vitest-environment happy-dom
/**
 * An avatar is Base UI's: the photo over the initials, the initials while it loads and if
 * it never does, and no wait for a photo the browser already has.
 *
 * Base UI's `Avatar.Image` keeps its own loading status, from `load` and `error` and — on
 * the commit that mounts it — from the image's own `complete`, so these read the DOM the
 * way the stylesheet does. happy-dom loads no images, so `load` is fired by hand and a
 * cached image is one whose `complete` is made true.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Avatar, AvatarWithPresence } from './Avatar.tsx';

afterEach(cleanup);

const ANA = { displayName: 'Ana Lima', avatarUrl: null };
const PHOTO = { displayName: 'Ana Lima', avatarUrl: '/files/ana.png' };
const NAMES = ['Ana Petrov', 'Marko Ilic', 'Devin Cole', 'Priya Raman', 'Ana Lima'];

const fallbackOf = (container: ParentNode) =>
  container.querySelector<HTMLElement>('[data-slot="avatar-fallback"]');
const imageOf = (container: ParentNode) =>
  container.querySelector<HTMLImageElement>('img[data-slot="avatar-image"]');

/** Swaps an image getter on the prototype for the length of `run`. */
function withImageGetter(name: 'complete' | 'naturalWidth', value: unknown, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, name);
  Object.defineProperty(HTMLImageElement.prototype, name, {
    configurable: true,
    get: () => value,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(HTMLImageElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLImageElement.prototype, name);
  }
}

/** Every image already complete: loaded, or broken when `width` is 0. */
const withImagesComplete = (width: number, run: () => void) =>
  withImageGetter('complete', true, () => withImageGetter('naturalWidth', width, run));

/** Every image still on its way. */
const withImagesPending = (run: () => void) => withImageGetter('complete', false, run);

describe('an avatar', () => {
  it('is the initial when there is no photo', () => {
    // One letter, as Meadow draws a person; two at the sidebar's 20px were a smudge.
    const { container } = render(<Avatar user={ANA} />);
    expect(container.querySelector('.avatar')!.textContent).toBe('A');
    expect(container.querySelector('img')).toBeNull();
    // The letter is the avatar's content when there is nothing else, so it is not hidden.
    expect(fallbackOf(container)!.hasAttribute('aria-hidden')).toBe(false);
  });

  it("is shadcn's avatar, at the sizes every caller relies on", () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { container } = render(<Avatar user={ANA} size={size} />);
      const root = container.querySelector<HTMLElement>('.avatar')!;
      expect(root.dataset.slot).toBe('avatar');
      expect(root.dataset.size).toBe(size);
      expect(root.getAttribute('title')).toBe('Ana Lima');
      cleanup();
    }
    const { container } = render(<Avatar user={ANA} />);
    expect(container.querySelector<HTMLElement>('.avatar')!.dataset.size).toBe('md');
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
    expect(new Set(NAMES.map(toneOf))).toEqual(new Set(['clay', 'sage']));
  });

  it('paints the tone it names, and an agent in iris whatever the name says', () => {
    // The stylesheet rules that keyed off `data-tone` and `data-kind` went with the rest of
    // the avatar's legacy CSS, so the colour is the root's own class now; this is what
    // stops it from quietly becoming one grey for everybody.
    const avatarOf = (user: Parameters<typeof Avatar>[0]['user']) => {
      const { container } = render(<Avatar user={user} />);
      const root = container.querySelector<HTMLElement>('.avatar')!;
      const seen = { tone: root.dataset.tone, classes: root.className };
      cleanup();
      return seen;
    };
    const people = NAMES.map((displayName) => avatarOf({ displayName, avatarUrl: null }));
    for (const { tone, classes } of people) {
      expect(classes).toContain(tone === 'clay' ? 'bg-(--clay)' : 'bg-(--avatar-bg)');
    }
    const clayName = NAMES[people.findIndex(({ tone }) => tone === 'clay')]!;
    const agent = avatarOf({ displayName: clayName, avatarUrl: null, kind: 'bot' });
    expect(agent.classes).toContain('--iris');
    expect(agent.classes).not.toContain('bg-(--clay)');
  });

  it('shows initials until the image loads, and the image after', () => {
    withImagesPending(() => {
      const { container } = render(<Avatar user={PHOTO} />);
      const image = imageOf(container)!;
      // A photo that never loads used to leave an empty square; the letter holds the place.
      expect(fallbackOf(container)!.textContent).toBe('A');
      // Decoration while a photo is coming: the name is the avatar's title, as before.
      expect(fallbackOf(container)!.getAttribute('aria-hidden')).toBe('true');
      expect(image.hasAttribute('data-loading')).toBe(true);

      fireEvent.load(image);
      expect(fallbackOf(container)).toBeNull();
      expect(image.hasAttribute('data-loading')).toBe(false);
      expect(image.getAttribute('src')).toBe('/files/ana.png');
    });
  });

  it('keeps the initials when the photo never arrives', () => {
    withImagesPending(() => {
      const { container } = render(<Avatar user={PHOTO} />);
      fireEvent.error(imageOf(container)!);
      expect(fallbackOf(container)!.textContent).toBe('A');
      expect(imageOf(container)!.hasAttribute('data-error')).toBe(true);
    });
  });

  it('keeps the initials for a photo already known to be broken', () => {
    withImagesComplete(0, () => {
      const { container } = render(<Avatar user={PHOTO} />);
      expect(fallbackOf(container)!.textContent).toBe('A');
      expect(imageOf(container)!.hasAttribute('data-error')).toBe(true);
    });
  });

  it('shows a photo the browser already holds on its first frame, with no initials and no fade', () => {
    // The message list is virtualised: a row mounts on every scroll, and its avatar with
    // it. A face that flashed its letter, or faded in, each time it scrolled back into
    // view would be motion keyed to mounting, which the list never does.
    //
    // What the browser paints first is the DOM once the commit, and every update its
    // layout effects queued, have run: React flushes those before it yields. This reads
    // the DOM as `render` returns, before any frame callback — Base UI clears an image's
    // `data-starting-style` on the next animation frame, so a photo that was going to fade
    // in still carries it here. An image that waited for its `load` event would still be
    // showing the letter, since happy-dom fires none.
    withImagesComplete(64, () => {
      const { container } = render(<Avatar user={PHOTO} />);
      const seen = () => {
        const image = imageOf(container);
        return {
          initials: fallbackOf(container) !== null,
          image: image !== null,
          fading: image?.hasAttribute('data-starting-style') ?? false,
          loading: image?.hasAttribute('data-loading') ?? false,
        };
      };
      expect(seen()).toEqual({ initials: false, image: true, fading: false, loading: false });

      // The browser still fires `load` on a cached image, a task later. It must find the
      // photo already shown and start nothing: no second entrance, and no letter back.
      fireEvent.load(imageOf(container)!);
      expect(seen()).toEqual({ initials: false, image: true, fading: false, loading: false });
    });
  });
});

describe('an avatar with presence', () => {
  it('keeps the presence dot', () => {
    const { container } = render(<AvatarWithPresence user={ANA} state="away" />);
    const wrapper = container.querySelector<HTMLElement>('.dm-avatar')!;
    const [avatar, dot] = [...wrapper.children] as HTMLElement[];
    // The sidebar's size, and the dot after the avatar inside the same box, where the
    // stylesheet pins it to the corner.
    expect(avatar!.classList.contains('avatar')).toBe(true);
    expect(avatar!.dataset.size).toBe('sm');
    expect(dot!.classList.contains('presence-dot')).toBe(true);
    expect(dot!.dataset.state).toBe('away');
    // Beside shadcn's part rather than inside it, so the legacy rule it shares with the
    // account menu's dot still reaches it.
    expect(dot!.closest('[data-slot]')).toBeNull();
  });
});
