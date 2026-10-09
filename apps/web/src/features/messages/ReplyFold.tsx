/**
 * A long answer from an agent, folded — "Show more", as Slack does it.
 *
 * An agent answers at the length of a document, and a conversation is read at the length
 * of a chat line: a plan or a review can run past a whole screen and push everything said
 * after it out of view. So an answer taller than about twenty lines of body text is drawn
 * clipped, its last lines fading into the card, with a button to open it.
 *
 * The height is the rendered one, measured, never a count of source lines: a line of
 * source can be a paragraph that wraps six times, and six lines of source can be one row
 * of a table. A ResizeObserver keeps it current — a web font arriving, the window being
 * resized, an edit — and nothing else counts.
 *
 * Opening one is somebody pressing a button, so nothing animates, on a press or on mount:
 * the list is virtualised and a row mounts on every scroll (CLAUDE.md, "motion in the
 * message list is keyed to arriving, never to mounting"). The row's new height reaches
 * the list the way every other change of height does: `MessageList` hands each row to
 * TanStack Virtual's `measureElement`, which watches the row's border box with its own
 * ResizeObserver and moves the rows below it.
 */

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { ChevronDownIcon } from "../../components/Icon.tsx";

/**
 * Taller than this many lines of body text, and an answer folds.
 *
 * Folded, it shows sixteen (`.reply-fold` in app.css), so a fold always hides four lines
 * or more: "Show more" that uncovered a single line would be a button for nothing. The
 * clip has to stay below this, or an answer in between would fold with nothing hidden.
 */
const FOLD_AFTER_LINES = 20;

/**
 * The answers somebody opened, for as long as the page is open.
 *
 * Outside React because a row's own state does not last: the list is virtualised, so a
 * row scrolled out of its window unmounts, and the one that mounts when it comes back
 * would start folded again — an answer you opened closing behind your back every time
 * you scrolled past it.
 */
const opened = new Set<string>();

interface Props {
  messageId: string;
  /** Whose answer, for a button name that stands alone in a list of buttons. */
  authorName: string | undefined;
  /** Follows the row's tab stop, like the row's other controls (`MessageRow`). */
  tabIndex: number;
  children: ReactNode;
}

export function ReplyFold({ messageId, authorName, tabIndex, children }: Props) {
  const [open, setOpen] = useState(() => opened.has(messageId));
  // Only a long answer can have been opened, so one that was is long until measured
  // otherwise — and draws its "Show less" in the same frame as the rest of it, rather
  // than one frame later under rows that were already placed.
  const [long, setLong] = useState(open);
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Where the button stood on screen when it was pressed to fold the answer back up.
  const foldedFrom = useRef<number | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    const clip = clipRef.current;
    const content = contentRef.current;
    if (!clip || !content) return undefined;
    // Before the first paint, so a long answer is never drawn open and then snapped shut.
    const measure = () =>
      setLong(
        content.getBoundingClientRect().height >
          FOLD_AFTER_LINES * lineHeightOf(clip) + 1,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Folding an answer you scrolled through to its end moves its button up by everything
  // that folded away — often off the top of the list, and the reader with it. Put the
  // button back where it was pressed. One still on screen stays put, and so does the list.
  useLayoutEffect(() => {
    const pressedAt = foldedFrom.current;
    foldedFrom.current = null;
    const toggle = toggleRef.current;
    if (open || pressedAt === null || !toggle) return;
    const scroller = scrollerOf(toggle);
    if (!scroller) return;
    const top = toggle.getBoundingClientRect().top;
    if (top >= scroller.getBoundingClientRect().top) return;
    scroller.scrollTop -= pressedAt - top;
  }, [open]);

  function show(next: boolean) {
    if (next) opened.add(messageId);
    else opened.delete(messageId);
    setOpen(next);
  }

  function onToggle() {
    if (open) foldedFrom.current = toggleRef.current?.getBoundingClientRect().top ?? null;
    show(!open);
  }

  const folded = long && !open;

  // Tab can reach a link below the fold, which the clip would leave focused where nobody
  // can see it. Arriving there opens the answer, as pressing the button would.
  function onFocus(event: FocusEvent<HTMLDivElement>) {
    if (!folded) return;
    const clip = event.currentTarget.getBoundingClientRect();
    if (event.target.getBoundingClientRect().bottom > clip.bottom) show(true);
  }

  const who = authorName ? `${authorName}'s message` : "this message";

  return (
    <>
      <div
        ref={clipRef}
        id={id}
        className="reply-fold"
        data-folded={folded ? "true" : undefined}
        onFocus={onFocus}
      >
        <div ref={contentRef} className="reply-fold-content">
          {children}
        </div>
      </div>
      {long && (
        <button
          ref={toggleRef}
          type="button"
          className="reply-fold-toggle"
          aria-expanded={open}
          aria-controls={id}
          // The words on the button, then whose: it starts with what is on screen, so
          // saying "show more" still finds it, and it means something on its own in a
          // list of every button on the page.
          aria-label={`${open ? "Show less" : "Show more"} of ${who}`}
          tabIndex={tabIndex}
          onClick={onToggle}
        >
          {open ? "Show less" : "Show more"}
          <ChevronDownIcon size="sm" />
        </button>
      )}
    </>
  );
}

/** One line of the answer's body text, in pixels. */
function lineHeightOf(node: Element): number {
  const style = getComputedStyle(node);
  const line = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(line) && line > 0) return line;
  // `normal`, or no stylesheet at all: about 1.2 of the font size.
  const size = Number.parseFloat(style.fontSize);
  return (Number.isFinite(size) && size > 0 ? size : 14) * 1.2;
}

/** The nearest ancestor that scrolls up and down — in a conversation, the message list. */
function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}
