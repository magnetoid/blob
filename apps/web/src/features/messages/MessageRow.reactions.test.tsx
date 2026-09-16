// @vitest-environment happy-dom
/**
 * A reaction chip is a toggle, and it has to say so.
 *
 * Whether you are already in a reaction decides what clicking it does — add one, or take
 * yours back. That state was carried only by `data-mine`, which is a CSS hook: it styles
 * the chip and tells assistive technology nothing, so a reader who cannot see the
 * highlight had no way to know which of the two things the button was about to do.
 * Lighthouse scores this page 100 and always would have — the button has a perfectly good
 * accessible name. Its *state* was the part that was missing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const ME = 'u-me';
const THEM = 'u-them';

const message = (reactors: string[]): Message =>
  ({
    id: '01a05000-0000-7000-8000-000000000001',
    channelId: 'c1',
    authorId: THEM,
    body: 'hello',
    kind: 'user',
    createdAt: '2026-08-31T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    reactions: [{ emoji: '👍', userIds: reactors }],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
  }) as unknown as Message;

const row = (reactors: string[]) => (
  <MessageRow message={message(reactors)} previous={null} onOpenThread={vi.fn()} />
);

function show(reactors: string[]) {
  useStore.setState({
    users: {
      [ME]: { id: ME, displayName: 'Me' },
      [THEM]: { id: THEM, displayName: 'Them' },
    },
    currentUser: {
      id: ME,
      displayName: 'Me',
      prefs: { language: null, autoTranslate: false },
    },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: new Set(),
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  return render(row(reactors));
}

/** The chip, found the way a screen-reader user reaches it: by role. */
const chip = () => screen.getAllByRole('button').find((b) => b.classList.contains('reaction'))!;

/** The number on the chip, as its own element so it can be animated on its own. */
const count = () => chip().querySelector('.reaction-count')!;

describe('a reaction chip', () => {
  it('is pressed when the reaction is yours', () => {
    show([ME, THEM]);
    expect(chip().getAttribute('aria-pressed')).toBe('true');
  });

  it('is not pressed when other people reacted and you did not', () => {
    // The case that matters: a chip with a count on it, which looks active either way.
    show([THEM]);
    expect(chip().getAttribute('aria-pressed')).toBe('false');
  });

  it('still carries the styling hook, which is a separate concern', () => {
    show([ME]);
    expect(chip().dataset.mine).toBe('true');
  });
});

/**
 * Somebody else reacting to a message you are looking at changes one digit, and until
 * now it changed silently. The count is keyed by its own value, so React replaces the
 * node when the number moves and the replacement plays `count-tick` on mount — the
 * whole mechanism is the remount, so what a test can hold onto is the node identity.
 */
describe('the count on a reaction chip', () => {
  it('is a node of its own, so the chip is not the thing that re-mounts', () => {
    show([THEM]);

    expect(count().className).toBe('reaction-count');
    expect(count().textContent).toBe('1');
  });

  it('is replaced when the number changes', () => {
    const { rerender } = show([THEM]);
    const before = count();

    rerender(row([THEM, ME]));

    expect(count().textContent).toBe('2');
    expect(count()).not.toBe(before);
  });

  it('is the same node when the number has not changed', () => {
    // Otherwise every unrelated re-render would pop a number that nobody touched.
    const { rerender } = show([THEM]);
    const before = count();

    rerender(row([THEM]));

    expect(count().textContent).toBe('1');
    expect(count()).toBe(before);
  });
});
