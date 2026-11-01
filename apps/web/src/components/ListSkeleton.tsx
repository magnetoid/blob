/**
 * A list that has not arrived yet, drawn as the shape it will have: a few rows of grey
 * lines breathing, where "Loading…" used to sit alone at the top of an empty pane.
 *
 * The conversation had this already (MessageList) — the Threads, Later, Activity, Files
 * and Pinned lists and Home's tasks said the word instead, so the app looked finished on
 * one screen and unfinished on the next. One component now, and the word kept for a screen
 * reader: a skeleton is decoration, and "Loading…" is what it means.
 *
 * Every grey shape is shadcn's Skeleton (`ui/skeleton`), pulsing as shadcn's does, and
 * still for anybody who asked for less motion — the global policy in base.css only clamps
 * a loop to one run, which would end on a flash. The class names left on the parts
 * (`message-skeleton-row` and the rest) style nothing; they name them.
 *
 * Shaped like what replaces it, or the point is lost when the real rows snap in: the
 * avatar at the size the rows draw theirs (a message's 36px, a pinned row's 20px, none in
 * Home's task card), and no padding of its own — each place insets it as its rows are
 * inset. A grid of files gets tiles (`TileSkeleton`).
 */

import { Skeleton } from './ui/skeleton.tsx';

const ROWS = 5;
/** Enough to fill a wide window's first rows; the grid fades out below them, so no width
 *  is left with a lone tile on a row of its own. */
const TILES = 12;

/** Stops for reduced motion. */
const STILL = 'motion-reduce:animate-none';

/**
 * Inset as each list's real rows are: the conversation's, a result row's 14px in Threads,
 * Later and Activity, and a pinned row's 8px, closer together. Home's task card insets
 * nothing — its rows sit flush with the card's own padding.
 */
const LIST = [
  'message-skeleton flex flex-col gap-[18px]',
  '[.message-list>&]:px-5 [.message-list>&]:py-6',
  '[.search-results>&]:p-3.5',
  '[.pinned-panel>&]:gap-3.5 [.pinned-panel>&]:p-2',
].join(' ');

/** Still, as it always was: a block of colour pulsing beside every row was the loudest
 *  thing on the screen. */
const AVATAR =
  'message-skeleton-avatar size-9 shrink-0 animate-none data-[size=sm]:size-5 data-[size=sm]:rounded-[7px]';

/** A name, then a line of a message. */
const NAME = `message-skeleton-line h-2.5 w-[120px] max-w-[60%] rounded-sm ${STILL}`;

/**
 * The message line's length varies by row, so five rows read as five different messages
 * rather than one stamped five times; and it breathes a beat after the name, or the lines
 * pulse as one block and read as a single flashing shape rather than as content arriving.
 */
const MESSAGE = ['w-[72%]', 'w-[55%]', 'w-[84%]', 'w-[40%]', 'w-[66%]'].map(
  (width) => `message-skeleton-line h-2.5 ${width} rounded-sm ${STILL} [animation-delay:120ms]`,
);

/** Files that have not arrived, in the grid they will arrive in — faded out downward, so
 *  it reads as "more to come" whatever number of columns the width gives it. */
const GRID =
  'files-grid files-grid-skeleton max-h-[340px] overflow-hidden [mask-image:linear-gradient(#000_45%,transparent)]';

/** Staggered across the grid for the same reason the lines are. */
function tile(index: number): string {
  // Counted as the stylesheet counted them, after the announcement: odd ones a beat late,
  // every third two beats.
  const place = index + 2;
  const delay =
    place % 3 === 0 ? '[animation-delay:240ms]' : place % 2 === 1 ? '[animation-delay:120ms]' : '';
  return `files-tile-skeleton aspect-square ${STILL} ${delay}`;
}

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
    <div className={LIST} aria-busy="true">
      <Announcement />
      {Array.from({ length: Math.min(rows, ROWS) }, (_, index) => (
        <div key={index} className="message-skeleton-row flex items-start gap-2.5" aria-hidden="true">
          {avatar !== "none" && <Skeleton className={AVATAR} data-size={avatar} />}
          <div className="message-skeleton-lines flex flex-1 flex-col gap-[7px] pt-[3px]">
            <Skeleton className={NAME} />
            <Skeleton className={MESSAGE[index]} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A grid of files that has not arrived: the grid's own squares, breathing. */
export function TileSkeleton({ tiles = TILES }: { tiles?: number }) {
  return (
    <div className={GRID} aria-busy="true">
      <Announcement />
      {Array.from({ length: tiles }, (_, index) => (
        <Skeleton key={index} className={tile(index)} aria-hidden="true" />
      ))}
    </div>
  );
}
