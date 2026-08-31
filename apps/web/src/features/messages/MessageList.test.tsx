// @vitest-environment happy-dom
/**
 * The list went from mapping every message into the DOM to windowing them, which is the
 * kind of change that looks identical until a channel is large. These assert the part
 * that is easy to lose: that the window is a window, that the scrollbar still represents
 * the whole history behind it, and that the dividers stayed attached to the right rows
 * when rendering stopped being one pass over the array.
 *
 * happy-dom has no layout, so every element measures zero. That makes scroll mathematics
 * untestable here and windowing very testable: with no viewport to fill, the virtualizer
 * renders its overscan and nothing else, so "far fewer rows than messages" is exactly the
 * property under test.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Message } from '@blob/shared';

/** Height the fake scroll container reports, and the height of one fake row. */
const VIEWPORT_PX = 800;
const ROW_PX = 40;

/**
 * happy-dom reports every element as zero-sized, and a virtualizer given a zero-height
 * viewport correctly decides that nothing is visible — so without this the component
 * renders no rows and every assertion below is vacuously about an empty list. Give the
 * scroll container a height and the rows a smaller one, which is the only geometry these
 * tests need.
 */
beforeAll(() => {
  // offsetHeight specifically: that is what the virtualizer measures with, for both the
  // scroll element and each row. Stubbing getBoundingClientRect instead looks equivalent
  // and changes nothing.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('message-list') ? VIEWPORT_PX : ROW_PX;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 600,
  });
});

// The row pulls in the store, the API client and the markdown renderer; none of that is
// what these tests are about, and mocking it keeps a failure here pointing at the list.
vi.mock('./MessageRow.tsx', () => ({
  MessageRow: ({ message }: { message: Message }) => (
    <div data-testid="row">{message.body}</div>
  ),
}));

const { MessageList } = await import('./MessageList.tsx');

afterEach(cleanup);

/** UUIDv7-ish ids: chronological string order is what the unread comparison relies on. */
function makeMessages(count: number, startDay = '2026-08-20'): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `0192${String(index).padStart(8, '0')}`,
    channelId: 'c1',
    authorId: 'u1',
    body: `message ${index}`,
    createdAt: `${startDay}T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    editedAt: null,
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments: [],
  })) as unknown as Message[];
}

type ListProps = Parameters<typeof MessageList>[0];

function renderList(overrides: Partial<ListProps> = {}) {
  const props: ListProps = {
    messages: makeMessages(500),
    hasMore: false,
    loading: false,
    onLoadOlder: vi.fn(),
    onOpenThread: vi.fn(),
    unreadAfterId: null,
    ...overrides,
  };
  return { ...render(<MessageList {...props} />), props };
}

describe('MessageList', () => {
  it('renders a window rather than every message', () => {
    const { container } = renderList();
    const rendered = container.querySelectorAll('.message-list-row').length;

    expect(rendered).toBeGreaterThan(0);
    // The exact count is the virtualizer's business; that it is nowhere near the whole
    // history is the point. Before virtualization this was 500.
    expect(rendered).toBeLessThan(100);
  });

  it('still reserves scroll height for the messages it did not render', () => {
    // Otherwise the scrollbar would describe the window instead of the conversation, and
    // dragging it would jump to the wrong place.
    const { container } = renderList();
    const viewport = container.querySelector('.message-list-viewport') as HTMLElement;

    expect(parseFloat(viewport.style.height)).toBeGreaterThan(1000);
  });

  it('estimates a row close to what a row measures', () => {
    // The estimate is what the virtualizer believes before it has measured anything, and
    // every scroll decision taken in that window is wrong by the difference. It used to
    // say 148px for rows that measure about 47, so a freshly opened channel thought it
    // was three times taller than it was and the "go to the newest message" scroll
    // landed hundreds of pixels short — you opened a busy channel in the middle of it.
    // 500 messages so the unmeasured ones dominate the reserved height: only the
    // window plus overscan is ever measured, and it is the estimate that decides the
    // rest. With 40 messages nearly all of them measure and the estimate barely shows.
    const { container } = renderList({ messages: makeMessages(500) });
    const viewport = container.querySelector('.message-list-viewport') as HTMLElement;

    const reservedPerRow = parseFloat(viewport.style.height) / 500;
    expect(reservedPerRow).toBeLessThan(ROW_PX * 2);
  });

  it('shows the empty state instead of a viewport when there is nothing to show', () => {
    const { container } = renderList({
      messages: [],
      emptyState: <p>No messages yet</p>,
    });

    expect(container.textContent).toContain('No messages yet');
    expect(container.querySelector('.message-list-viewport')).toBeNull();
  });

  it('offers to load older messages only when there are older messages', () => {
    const { container: without } = renderList({ hasMore: false });
    expect(without.querySelector('button')).toBeNull();

    cleanup();

    const { container: with_ } = renderList({ hasMore: true });
    expect(with_.querySelector('button')?.textContent).toContain('Load earlier');
  });

  it('marks the first message after the read boundary, and only that one', () => {
    // The divider is placed by comparing ids, so it survives windowing only if the
    // comparison runs over the whole array rather than over what is on screen.
    const messages = makeMessages(12);
    const { container } = renderList({
      messages,
      unreadAfterId: messages[2]!.id,
    });

    expect(container.querySelectorAll('.unread-divider')).toHaveLength(1);
  });

  it('starts a day divider when the calendar day changes', () => {
    const messages = [
      ...makeMessages(3, '2026-08-19'),
      ...makeMessages(3, '2026-08-20').map((message, index) => ({
        ...message,
        id: `0193${String(index).padStart(8, '0')}`,
      })),
    ];
    const { container } = renderList({ messages });

    // One for the first message of each day, and no more than that.
    expect(container.querySelectorAll('.day-divider')).toHaveLength(2);
  });
});
