/**
 * A list that has not arrived yet, drawn as the shape it will have: a few rows of grey
 * lines breathing, where "Loading…" used to sit alone at the top of an empty pane.
 *
 * The conversation had this already (MessageList) — the Threads, Later, Activity, Files
 * and Pinned lists and Home's tasks said the word instead, so the app looked finished on
 * one screen and unfinished on the next. One component now, the widths in the stylesheet
 * rather than inline, and the word kept for a screen reader: a skeleton is decoration, and
 * "Loading…" is what it means.
 *
 * Shaped like what replaces it, or the point is lost when the real rows snap in: the
 * avatar at the size the rows draw theirs (a message's 36px, a pinned row's 20px, none in
 * Home's task card), and no padding of its own — each place insets it as its rows are
 * inset (app.css, "loading skeleton"). A grid of files gets tiles (`TileSkeleton`).
 */

const ROWS = 5;
/** Enough to fill a wide window's first rows; the grid fades out below them, so no width
 *  is left with a lone tile on a row of its own. */
const TILES = 12;

function Announcement() {
  return (
    <span className="sr-only" role="status">
      Loading…
    </span>
  );
}

export function ListSkeleton({
  rows = ROWS,
  avatar = "lg",
}: {
  /** How many rows to draw; a small card wants fewer than a pane. */
  rows?: number;
  /** The avatar each row leads with, at the size the real rows draw it, or none. */
  avatar?: "lg" | "sm" | "none";
}) {
  return (
    <div className="message-skeleton" aria-busy="true">
      <Announcement />
      {Array.from({ length: Math.min(rows, ROWS) }, (_, index) => (
        <div key={index} className="message-skeleton-row" aria-hidden="true">
          {avatar !== "none" && <span className="message-skeleton-avatar" data-size={avatar} />}
          <span className="message-skeleton-lines">
            <span className="message-skeleton-line" />
            <span className="message-skeleton-line" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A grid of files that has not arrived: the grid's own squares, breathing. */
export function TileSkeleton({ tiles = TILES }: { tiles?: number }) {
  return (
    <div className="files-grid files-grid-skeleton" aria-busy="true">
      <Announcement />
      {Array.from({ length: tiles }, (_, index) => (
        <span key={index} className="files-tile-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}
