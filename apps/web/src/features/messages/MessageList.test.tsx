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
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Message } from "@blob/shared";
import { useStore } from "../../lib/store.ts";
import { FALLBACK_MS } from "../../lib/usePresence.ts";

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
  // offsetHeight is what the virtualizer used to measure with. The list now measures
  // with getBoundingClientRect so subpixels and padding count; stub both, or happy-dom
  // reports every element as zero and the window is empty.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("message-list") ? VIEWPORT_PX : ROW_PX;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 600,
  });
  // What the list reads to know which rows are on screen. happy-dom keeps a scrollTop
  // that `scrollTo` sets, but reports every clientHeight as zero.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("message-list") ? VIEWPORT_PX : ROW_PX;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.classList.contains("message-list") ? VIEWPORT_PX : ROW_PX;
    return {
      x: 0,
      y: 0,
      width: 600,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 600,
      toJSON() {
        return {};
      },
    };
  };
});

// The row pulls in the store, the API client and the markdown renderer; none of that is
// what these tests are about, and mocking it keeps a failure here pointing at the list.
vi.mock("./MessageRow.tsx", () => ({
  MessageRow: ({ message }: { message: Message }) => (
    <div data-testid="row">{message.body}</div>
  ),
}));

const { MessageList } = await import("./MessageList.tsx");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Past usePresence's fallback, which is what ends an exit here: happy-dom runs no
 *  animations, so the `animationend` a browser would send never comes. */
const EXIT_SETTLED_MS = FALLBACK_MS + 100;

/** UUIDv7-ish ids: chronological string order is what the unread comparison relies on. */
function makeMessages(count: number, startDay = "2026-08-20"): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `0192${String(index).padStart(8, "0")}`,
    channelId: "c1",
    authorId: "u1",
    body: `message ${index}`,
    createdAt: `${startDay}T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
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
    conversationId: 'c1',
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

describe("MessageList", () => {
  it("renders a window rather than every message", () => {
    const { container } = renderList();
    const rendered = container.querySelectorAll(".message-list-row").length;

    expect(rendered).toBeGreaterThan(0);
    // The exact count is the virtualizer's business; that it is nowhere near the whole
    // history is the point. Before virtualization this was 500.
    expect(rendered).toBeLessThan(100);
  });

  it("still reserves scroll height for the messages it did not render", () => {
    // Otherwise the scrollbar would describe the window instead of the conversation, and
    // dragging it would jump to the wrong place.
    //
    // This asserts the inline style, which is all happy-dom can offer: it does no layout,
    // so a spacer that is *declared* 6,711px tall and then crushed to 488 by a flex
    // parent reads as correct here. That exact bug shipped and survived twenty commits.
    // The guard against it is `flex: none` on .message-list-viewport, and a browser.
    const { container } = renderList();
    const viewport = container.querySelector(
      ".message-list-viewport",
    ) as HTMLElement;

    expect(parseFloat(viewport.style.height)).toBeGreaterThan(1000);
  });

  it("estimates a row close to what a row measures", () => {
    // The estimate is what the virtualizer believes before it has measured anything, and
    // every scroll decision taken in that window is wrong by the difference. It used to
    // say 148px for rows that measure about 47, so a freshly opened channel thought it
    // was three times taller than it was and the "go to the newest message" scroll
    // landed hundreds of pixels short — you opened a busy channel in the middle of it.
    // 500 messages so the unmeasured ones dominate the reserved height: only the
    // window plus overscan is ever measured, and it is the estimate that decides the
    // rest. With 40 messages nearly all of them measure and the estimate barely shows.
    const { container } = renderList({ messages: makeMessages(500) });
    const viewport = container.querySelector(
      ".message-list-viewport",
    ) as HTMLElement;

    const reservedPerRow = parseFloat(viewport.style.height) / 500;
    expect(reservedPerRow).toBeLessThan(ROW_PX * 2);
  });

  it("shows the empty state instead of a viewport when there is nothing to show", () => {
    const { container } = renderList({
      messages: [],
      emptyState: <p>No messages yet</p>,
    });

    expect(container.textContent).toContain("No messages yet");
    expect(container.querySelector(".message-list-viewport")).toBeNull();
  });

  it("offers to load older messages only when there are older messages", () => {
    const { container: without } = renderList({ hasMore: false });
    expect(without.querySelector("button")).toBeNull();

    cleanup();

    const { container: with_ } = renderList({ hasMore: true });
    expect(with_.querySelector("button")?.textContent).toContain(
      "Load earlier",
    );
  });

  it("draws the divider on the very first row when the whole page is unread", () => {
    // You were away, fifty messages arrived, and the page the server returns begins
    // *after* your cursor — so the first loaded message is the first unread one.
    // `isFirstUnread` required a previous message, so index 0 could never be the
    // divider: the jump bar offered "N new messages" and scrolled to a row with no
    // marker on it. The divider went missing in exactly the case with the most unread.
    const { container } = renderList({
      messages: makeMessages(12),
      unreadAfterId: "0191",
    });

    expect(container.querySelectorAll(".unread-divider")).toHaveLength(1);
  });

  it("marks the first message after the read boundary, and only that one", () => {
    // The divider is placed by comparing ids, so it survives windowing only if the
    // comparison runs over the whole array rather than over what is on screen.
    const messages = makeMessages(12);
    const { container } = renderList({
      messages,
      unreadAfterId: messages[2]!.id,
    });

    expect(container.querySelectorAll(".unread-divider")).toHaveLength(1);
  });

  it("starts a day divider when the calendar day changes", () => {
    const messages = [
      ...makeMessages(3, "2026-08-19"),
      ...makeMessages(3, "2026-08-20").map((message, index) => ({
        ...message,
        id: `0193${String(index).padStart(8, "0")}`,
      })),
    ];
    const { container } = renderList({ messages });

    // One for the first message of each day, and no more than that.
    expect(container.querySelectorAll(".day-divider")).toHaveLength(2);
  });

  /**
   * Jumping to a message is the list's job, not the router's.
   *
   * `showMessage` and the pin panel used to find the row with `querySelector` and scroll
   * it into view. With a window of about twenty rows that lookup misses every target
   * that is not already on screen, so search results, permalinks, saved items and pins
   * all quietly became "open the channel at the bottom".
   */
  describe("a requested jump", () => {
    // The scroll itself is not assertable here — happy-dom does no layout, so
    // `scrollToIndex` sets a scrollTop that nothing acts on and the rendered window
    // never moves. What these can prove is the routing: which list answers a request and
    // which declines. That the row actually arrives on screen, highlighted, was checked
    // in a browser against three thousand messages.
    it("takes a request for a message it holds", async () => {
      const messages = makeMessages(500);
      useStore.setState({ pendingScrollMessageId: messages[400]!.id });
      renderList({ messages });

      await waitFor(() =>
        expect(useStore.getState().pendingScrollMessageId).toBeNull(),
      );
    });

    it("leaves a request standing for a message it does not hold", async () => {
      // What lets the thread panel answer for a reply. A reply is never in channel
      // history, so the channel list has to decline rather than consume the request —
      // otherwise the panel beside it would never see one.
      useStore.setState({ pendingScrollMessageId: "a-thread-reply" });
      renderList({ messages: makeMessages(20) });

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(useStore.getState().pendingScrollMessageId).toBe("a-thread-reply");
    });
  });

  describe("the unread jump bar", () => {
    /**
     * Say where the list is scrolled to, as a browser would report it.
     *
     * Whether the bar is offered depends on what is on screen, and happy-dom cannot say:
     * it does not clamp scrollTop, and the virtualizer's corrections for rows that measured
     * smaller than estimated leave it at -800 or at 0 depending on which tests ran first.
     * A test about what is on screen therefore states where the screen is. The list's own
     * writes are ignored, the way a browser keeps a scroll the content cannot support.
     */
    function pinScroll(top: number) {
      let current = top;
      Object.defineProperty(HTMLElement.prototype, "scrollTop", {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("message-list") ? current : 0;
        },
        set() {},
      });
      return {
        to(next: number) {
          current = next;
        },
      };
    }

    afterEach(() => {
      delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
    });

    function renderWithUnread() {
      const messages = makeMessages(500);
      // 99 of them are after the cursor.
      return renderList({ messages, unreadAfterId: messages[400]!.id });
    }

    it("offers the count, marked open", () => {
      const { container } = renderWithUnread();
      const bar = container.querySelector(".unread-jump-bar");

      expect(bar).toBeTruthy();
      expect(bar!.getAttribute("data-state")).toBe("open");
      expect(bar!.hasAttribute("inert")).toBe(false);
      expect(bar!.textContent).toContain("99 new messages");
    });

    it("is held for its exit, still counting what it counted", () => {
      // The channel is read out from under the bar: `unreadCount` is 0 on the same render
      // that closes it, so a bar rendering from it would fade away saying "0 new
      // messages" — and React would have dropped the node before it could fade at all.
      const { container, rerender, props } = renderWithUnread();

      vi.useFakeTimers();
      rerender(<MessageList {...props} unreadAfterId={null} />);

      const leaving = container.querySelector(".unread-jump-bar");
      expect(leaving).toBeTruthy();
      expect(leaving!.getAttribute("data-state")).toBe("closed");
      expect(leaving!.textContent).toContain("99 new messages");
      // Out of the tab order and the accessibility tree for the 150ms it is still there:
      // it offers a jump into a conversation that has been read.
      expect(leaving!.hasAttribute("inert")).toBe(true);

      act(() => {
        vi.advanceTimersByTime(EXIT_SETTLED_MS);
      });

      expect(container.querySelector(".unread-jump-bar")).toBeNull();
    });

    it("goes away once the first new message has been on screen", () => {
      // What the bar is for is getting you to the first thing you have not read. Once
      // that has been in view it has done its job, and a bar still offering to jump
      // there — over the messages it names — reads as the app not noticing.
      // 30 rows, the first unread the sixth; the screen is the bottom 800px.
      const scroll = pinScroll(800);
      const messages = makeMessages(30);
      const { container } = renderList({ messages, unreadAfterId: messages[4]!.id });
      const list = container.querySelector(".message-list") as HTMLElement;
      expect(container.querySelector(".unread-jump-bar")?.getAttribute("data-state")).toBe(
        "open",
      );

      vi.useFakeTimers();
      act(() => {
        // Up to the top, where the first unread row sits; happy-dom sends no scroll
        // event of its own for a changed scrollTop.
        scroll.to(0);
        list.dispatchEvent(new Event("scroll"));
      });

      expect(container.querySelector(".unread-jump-bar")?.getAttribute("data-state")).toBe(
        "closed",
      );
      act(() => {
        vi.advanceTimersByTime(EXIT_SETTLED_MS);
      });
      expect(container.querySelector(".unread-jump-bar")).toBeNull();
    });

    it("never appears when the first new message is already on screen", () => {
      // Opened at the bottom with the unread tail in view: there is nothing to jump to,
      // and a bar that entered only to fade out again would be noise.
      pinScroll(800);
      const messages = makeMessages(30);
      const { container } = renderList({ messages, unreadAfterId: messages[26]!.id });

      expect(container.querySelector(".unread-jump-bar")).toBeNull();
      // The divider is still drawn: it marks where you left off, which is a different
      // job from offering to take you there.
      expect(container.querySelector(".unread-divider")).toBeTruthy();
    });

    it("does not follow you into the next conversation", () => {
      // The list is not remounted on a channel switch — that is the point of
      // `conversationId` and the reset effect, and it is what makes a held bar dangerous.
      // Without an identity of its own the bar stays present across the switch and plays
      // the last channel's exit, counting the last channel's unread, over a channel that
      // has been read.
      const { container, rerender, props } = renderWithUnread();
      expect(container.querySelector(".unread-jump-bar")).toBeTruthy();

      rerender(
        <MessageList
          {...props}
          conversationId="c2"
          messages={makeMessages(20, "2026-08-21")}
          unreadAfterId={null}
        />,
      );

      // Not "closed", not present at all: there is nothing here that was ever open.
      expect(container.querySelector(".unread-jump-bar")).toBeNull();
      expect(container.textContent).not.toContain("99 new messages");
    });
  });
});
