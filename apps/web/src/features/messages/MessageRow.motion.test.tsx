// @vitest-environment happy-dom
/**
 * What moves on a row, and — the part that is easy to get wrong in a virtualised list —
 * what does not.
 *
 * A row mounts again every time it scrolls into view and on every channel switch. So
 * nothing on it may key its motion to mounting: the arrival is the store's mark, and
 * everything that can turn up later — a link preview, a reaction, a reply — is compared
 * against what the row was first drawn with. A test can hold onto the attributes the
 * stylesheet keys off; happy-dom plays no animations, so their ends are fired by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const ME = 'u-me';
const THEM = 'u-them';
const ID = '01a05000-0000-7000-8000-000000000001';

const message = (extra: Partial<Message> = {}): Message =>
  ({
    id: ID,
    channelId: 'c1',
    authorId: THEM,
    body: 'see https://example.com',
    kind: 'user',
    createdAt: '2026-08-31T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    replyUserIds: [],
    lastReplyAt: null,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    linkPreview: null,
    ...extra,
  }) as unknown as Message;

const row = (m: Message) => <MessageRow message={m} previous={null} onOpenThread={vi.fn()} />;

beforeEach(() => {
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
    freshMessages: new Map(),
    channels: {},
    messageDeliveryState: () => null,
  } as never);
});

const article = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(`[data-message-id="${ID}"]`)!;

describe('a message arriving', () => {
  it('plays its entrance only while the store says it is arriving, and settles it after', () => {
    useStore.setState({ freshMessages: new Map([[ID, null]]) });
    const { container } = render(row(message()));
    const node = article(container);
    expect(node.dataset.fresh).toBe('true');

    // Something ending inside the row — a reaction popping — is not the entrance ending.
    act(() => {
      node.querySelector('.message-body')!.dispatchEvent(
        new Event('animationend', { bubbles: true }),
      );
    });
    expect(useStore.getState().freshMessages.has(ID)).toBe(true);

    act(() => {
      node.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(useStore.getState().freshMessages.has(ID)).toBe(false);
    expect(node.dataset.fresh).toBeUndefined();
  });

  it('starts it from the beginning, and records when, as the first row to draw it', () => {
    // Timed from the row rather than the socket frame: a render can land tens of
    // milliseconds after the frame, and an entrance timed from the frame would be partly
    // over before it was seen.
    useStore.setState({ freshMessages: new Map([[ID, null]]) });
    const before = performance.now();
    const { container } = render(row(message()));

    expect(article(container).style.animationDelay).toBe('');
    expect(useStore.getState().freshMessages.get(ID)).toBeGreaterThanOrEqual(before);
  });

  it('does not play it again when the row mounts again', () => {
    // Scrolling away and back, or switching channel and back: the same message, a new row.
    useStore.setState({ freshMessages: new Map([[ID, null]]) });
    const first = render(row(message()));
    act(() => {
      article(first.container).dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    first.unmount();

    const { container } = render(row(message()));
    expect(article(container).dataset.fresh).toBeUndefined();
  });

  it('picks the entrance up where it had got to, when it began before this row did', () => {
    // The server's copy of a message you sent, standing in for the pending row that was
    // already partway in.
    useStore.setState({ freshMessages: new Map([[ID, performance.now() - 60]]) });
    const { container } = render(row(message()));

    expect(Number.parseFloat(article(container).style.animationDelay)).toBeLessThanOrEqual(-60);
  });

  it('draws no mark for a row that is only being drawn', () => {
    const { container } = render(row(message()));
    expect(article(container).dataset.fresh).toBeUndefined();
  });
});

describe('something turning up under a message', () => {
  const preview = { url: 'https://example.com', title: 'Example', description: null };

  it('marks a link preview that arrives after the row was drawn', () => {
    const { container, rerender } = render(row(message()));
    rerender(row(message({ linkPreview: preview } as Partial<Message>)));

    expect(container.querySelector<HTMLElement>('.link-preview')!.dataset.arrived).toBe('true');
  });

  it('leaves alone a preview the row was drawn with', () => {
    const { container } = render(row(message({ linkPreview: preview } as Partial<Message>)));

    expect(container.querySelector<HTMLElement>('.link-preview')!.dataset.arrived).toBeUndefined();
  });

  it('pops a reaction chip that appears while the row is on screen, and no other', () => {
    const { container, rerender } = render(
      row(message({ reactions: [{ emoji: '👍', userIds: [THEM] }] })),
    );
    rerender(
      row(
        message({
          reactions: [
            { emoji: '👍', userIds: [THEM] },
            { emoji: '🎉', userIds: [ME] },
          ],
        }),
      ),
    );

    const chips = Array.from(container.querySelectorAll<HTMLElement>('.reaction'));
    expect(chips.map((chip) => chip.dataset.arrived)).toEqual([undefined, 'true']);
  });

  it('ticks a reply count when it changes, and not when it is drawn', () => {
    const { container, rerender } = render(row(message({ replyCount: 2 })));
    const count = () => container.querySelector<HTMLElement>('.thread-summary-count')!;
    expect(count().textContent).toBe('2 replies');
    expect(count().dataset.changed).toBeUndefined();

    const before = count();
    rerender(row(message({ replyCount: 3 })));

    expect(count().textContent).toBe('3 replies');
    expect(count()).not.toBe(before);
    expect(count().dataset.changed).toBe('true');
  });
});
