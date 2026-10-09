// @vitest-environment happy-dom
/**
 * A long answer folds behind "Show more" — measured, toggled, and remembered.
 *
 * happy-dom has no layout, so the measurement is the test's: every element reports the
 * box `rectOf` gives it, and a fake ResizeObserver lets a test say "the answer changed
 * size" when it wants. What is under test is what ReplyFold does with those numbers: fold
 * only what overflows, say what the button does in words that stand alone, and keep an
 * answer open across the remount a virtualised list puts every row through.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReplyFold } from "./ReplyFold.tsx";

/** Tall enough to fold at any line height a browser or happy-dom could report. */
const LONG_PX = 5000;
/** Short enough never to. */
const SHORT_PX = 40;

let contentHeight = SHORT_PX;
/** Element → its box, for the cases that need more than the answer's height. */
let rectOf: (element: Element) => Partial<DOMRect> | undefined = () => undefined;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  /** What a browser does when the observed box changes size. */
  resize() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const height = this.classList.contains("reply-fold-content") ? contentHeight : 0;
    const box = { x: 0, y: 0, width: 600, height, top: 0, left: 0, bottom: height, right: 600 };
    return { ...box, ...rectOf(this), toJSON: () => ({}) } as DOMRect;
  };
});

afterAll(() => {
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

beforeEach(() => {
  contentHeight = SHORT_PX;
  rectOf = () => undefined;
  FakeResizeObserver.instances = [];
});

afterEach(cleanup);

/** Message ids are what the open state is remembered by, so every test gets its own. */
let next = 0;
const freshId = () => `0199${String((next += 1)).padStart(8, "0")}`;

function fold(messageId: string, tabIndex = 0) {
  return render(
    <ReplyFold messageId={messageId} authorName="Janus" tabIndex={tabIndex}>
      <p>
        The answer, with <a href="https://example.com/end">a link at its end</a>.
      </p>
    </ReplyFold>,
  );
}

const clipOf = (container: HTMLElement) =>
  container.querySelector(".reply-fold") as HTMLElement;

describe("folding a long answer", () => {
  it("leaves an answer that fits alone: no fold, no button", () => {
    const { container } = fold(freshId());
    expect(clipOf(container).hasAttribute("data-folded")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("folds one taller than the limit, behind Show more", () => {
    contentHeight = LONG_PX;
    const { container } = fold(freshId());
    expect(clipOf(container).getAttribute("data-folded")).toBe("true");
    const button = screen.getByRole("button", { name: "Show more of Janus's message" });
    expect(button.textContent).toBe("Show more");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // It names what it opens.
    expect(button.getAttribute("aria-controls")).toBe(clipOf(container).id);
  });

  it("measures the rendered height, again whenever it changes", () => {
    const { container } = fold(freshId());
    expect(screen.queryByRole("button")).toBeNull();

    // A web font arriving, a narrower window, an edit: the box grows, the observer says so.
    contentHeight = LONG_PX;
    act(() => FakeResizeObserver.instances.forEach((observer) => observer.resize()));
    expect(clipOf(container).getAttribute("data-folded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Show more/ })).toBeTruthy();

    contentHeight = SHORT_PX;
    act(() => FakeResizeObserver.instances.forEach((observer) => observer.resize()));
    expect(clipOf(container).hasAttribute("data-folded")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens and closes on the button, saying which it will do", () => {
    contentHeight = LONG_PX;
    const { container } = fold(freshId());

    fireEvent.click(screen.getByRole("button", { name: "Show more of Janus's message" }));
    const open = screen.getByRole("button", { name: "Show less of Janus's message" });
    expect(open.textContent).toBe("Show less");
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(clipOf(container).hasAttribute("data-folded")).toBe(false);

    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "Show more of Janus's message" })).toBeTruthy();
    expect(clipOf(container).getAttribute("data-folded")).toBe("true");
  });

  it("names whose message when it knows, and still stands alone when it does not", () => {
    contentHeight = LONG_PX;
    render(
      <ReplyFold messageId={freshId()} authorName={undefined} tabIndex={0}>
        <p>An answer.</p>
      </ReplyFold>,
    );
    expect(screen.getByRole("button", { name: "Show more of this message" })).toBeTruthy();
  });

  it("follows the row's tab stop, like the row's other controls", () => {
    contentHeight = LONG_PX;
    fold(freshId(), -1);
    expect(screen.getByRole("button").tabIndex).toBe(-1);
    cleanup();
    fold(freshId(), 0);
    expect(screen.getByRole("button").tabIndex).toBe(0);
  });

  it("stays open when its row is unmounted and mounted again", () => {
    // The virtualised list does this to every row scrolled out of its window and back.
    contentHeight = LONG_PX;
    const id = freshId();
    fold(id);
    fireEvent.click(screen.getByRole("button", { name: /^Show more/ }));
    cleanup();

    const { container } = fold(id);
    // Open from its first frame: the button already says Show less, nothing is clipped.
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button").textContent).toBe("Show less");
    expect(clipOf(container).hasAttribute("data-folded")).toBe(false);

    // Another message is its own: still folded.
    cleanup();
    fold(freshId());
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });

  it("stays folded again once it was folded again", () => {
    contentHeight = LONG_PX;
    const id = freshId();
    fold(id);
    fireEvent.click(screen.getByRole("button", { name: /^Show more/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Show less/ }));
    cleanup();
    fold(id);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens when the keyboard reaches a link below the fold", () => {
    contentHeight = LONG_PX;
    rectOf = (element) =>
      element.classList.contains("reply-fold")
        ? { top: 0, bottom: 360 }
        : element.tagName === "A"
          ? { top: 880, bottom: 900 }
          : undefined;
    const { container } = fold(freshId());
    act(() => screen.getByRole("link").focus());
    expect(clipOf(container).hasAttribute("data-folded")).toBe(false);
    expect(screen.getByRole("button").textContent).toBe("Show less");
  });

  describe("folding back up, from the end of a long answer", () => {
    /** An open answer in a scrolling list, its button at 500px — and, once folded, at
     *  `foldedTop`, which is where the clip would leave it. */
    function openInList(foldedTop: number) {
      contentHeight = LONG_PX;
      const { container } = render(
        <div className="list">
          <ReplyFold messageId={freshId()} authorName="Janus" tabIndex={0}>
            <p>An answer.</p>
          </ReplyFold>
        </div>,
      );
      const list = container.querySelector(".list") as HTMLElement;
      list.style.overflowY = "auto";
      list.scrollTop = 1000;
      fireEvent.click(screen.getByRole("button", { name: /^Show more/ }));
      rectOf = (element) => {
        if (element === list) return { top: 0, bottom: 800 };
        if (!element.classList.contains("reply-fold-toggle")) return undefined;
        const folded = clipOf(container).hasAttribute("data-folded");
        return folded ? { top: foldedTop, bottom: foldedTop + 20 } : { top: 500, bottom: 520 };
      };
      return list;
    }

    it("puts the button back where it was pressed when the fold would lift it off the top", () => {
      const list = openInList(-200);
      fireEvent.click(screen.getByRole("button", { name: /^Show less/ }));
      // Up by everything that folded away: the button is at 500 again, under the pointer.
      expect(list.scrollTop).toBe(1000 - (500 - -200));
    });

    it("leaves the list where it is when the button is still in sight", () => {
      const list = openInList(120);
      fireEvent.click(screen.getByRole("button", { name: /^Show less/ }));
      expect(list.scrollTop).toBe(1000);
    });
  });

  it("leaves the fold alone when the focused link is in sight", () => {
    contentHeight = LONG_PX;
    rectOf = (element) =>
      element.classList.contains("reply-fold")
        ? { top: 0, bottom: 360 }
        : element.tagName === "A"
          ? { top: 20, bottom: 40 }
          : undefined;
    const { container } = fold(freshId());
    act(() => screen.getByRole("link").focus());
    expect(clipOf(container).getAttribute("data-folded")).toBe("true");
  });
});
