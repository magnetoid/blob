/** Nothing here, said the same way everywhere.
 *
 * Twenty-one screens each built this from the same three divs, and some had begun to
 * drift: an `aria-hidden` on one mark and not the next, a button with its own margin
 * in one place and none in another. One component, one place for the rule that a mark
 * is decoration and that whatever follows the body sits at the same distance from it.
 *
 * shadcn's Empty (`ui/empty`) at Meadow's measure: its parts and their names, Blob's
 * column, type and spacing. The class `empty-state` styles nothing of its own; it is the
 * name the console card's variant below, and the tests, find the root by.
 */

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { onFirstView } from '../lib/firstView.ts';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from './ui/empty.tsx';

/**
 * A reading column near the top of the pane rather than shadcn's box centred in whatever
 * it is given: Empty grows (`flex-1`) and centres itself vertically, which in a view's
 * flex column would push the words to the middle of the screen. The parts keep their own
 * distances, so the gap goes.
 *
 * In a console card it is the card's notice instead — the card's padding, a title in the
 * card's type rather than a page's (`.console-card > .empty-state`, the one place a
 * caller's context changes it).
 */
const ROOT = [
  'empty-state mx-auto my-[60px] max-w-[520px] flex-none gap-0 px-6 py-0',
  '[.console-card>&]:mt-4 [.console-card>&]:mb-0 [.console-card>&]:px-4 [.console-card>&]:py-6',
].join(' ');

/**
 * Only on the view the app opened onto, before anything on it has been touched
 * (`lib/firstView`): the first thing on the screen is worth a beat. Every view after that
 * is one somebody switched to — Threads, Later, Activity, Scheduled, Tasks, Files, a
 * console section, or a tab or a filter inside one — and switching stays instant, so an
 * empty state there simply appears.
 *
 * And never in a conversation, a search or the channel browser, even on that first view:
 * the first is a channel switch away from playing on every switch, and the other two flip
 * between results and nothing as a filter is typed or toggled. The search is told apart by
 * its head — `.search-results` alone is also the list in Saved, Activity, Threads and
 * Tasks. One selector, so the exceptions cannot lose a specificity contest with the rule.
 */
const ARRIVE =
  '[&[data-arriving=true]:not(.message-list_*,.search-head~.search-results_*,.browse-body_*)]:animate-[arrive_var(--dur-open)_var(--blob-ease-out)]';

/** A badge in the accent wash, the glyph at the title's size. */
const MARK =
  'empty-state-mark mb-[18px] size-11 rounded-(--blob-radius-lg) bg-(--blob-accent-wash-soft) text-(length:--blob-text-lg) font-semibold text-(--blob-accent)';

const TITLE =
  'empty-state-title text-(length:--blob-text-lg) font-semibold tracking-[-0.015em] [.console-card>.empty-state_&]:text-(length:--text-title)';

const BODY = [
  'empty-state-body mt-2 text-(length:--blob-text-base) leading-[1.6] text-pretty text-(--text-3)',
  '[.console-card>.empty-state_&]:mt-1 [.console-card>.empty-state_&]:text-(length:--text-row) [.console-card>.empty-state_&]:text-(--text-4)',
].join(' ');

/** Whatever follows the body — a retry, a way back — sits one step below it, a button or
 *  two side by side. */
const ACTION = 'empty-state-action mt-3 flex-row flex-wrap justify-center gap-2';

const present = (node: ReactNode) => node !== undefined && node !== null && node !== false;

/**
 * A caller's own markup — the body's `<code>`, the action's `.btn` — is legacy markup
 * inside a shadcn component, where preflight's reset holds and base.css's repair stops.
 * An island hands it back, as a dialog's body is handed back (`components/Dialog`).
 */
function Legacy({ children }: { children: ReactNode }) {
  return (
    <span data-legacy="" className="contents">
      {children}
    </span>
  );
}

export function EmptyState({
  mark,
  title,
  action,
  children,
  className,
  ...rest
}: {
  /** An icon or a glyph. Decoration: the title says what the screen is. */
  mark?: ReactNode;
  title: ReactNode;
  /** A button or two, rendered after the body. */
  action?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  // Decided once, as it mounts: an empty state the app opened onto arrives, and one it
  // was switched to just appears. See `lib/firstView`.
  const [arriving] = useState(onFirstView);
  return (
    <Empty
      // Empty merges this after its own classes, so these win where they meet.
      className={className ? `${ROOT} ${ARRIVE} ${className}` : `${ROOT} ${ARRIVE}`}
      data-arriving={arriving ? 'true' : undefined}
      {...rest}
    >
      {mark !== undefined && (
        <EmptyMedia className={MARK} aria-hidden="true">
          {mark}
        </EmptyMedia>
      )}
      <EmptyTitle className={TITLE}>{title}</EmptyTitle>
      {present(children) && (
        <EmptyDescription className={BODY}>
          <Legacy>{children}</Legacy>
        </EmptyDescription>
      )}
      {present(action) && (
        <EmptyContent className={ACTION}>
          <Legacy>{action}</Legacy>
        </EmptyContent>
      )}
    </Empty>
  );
}
