/**
 * The scrolling message list.
 *
 * Two behaviours matter here and are easy to get wrong: it sticks to the bottom only
 * when you are already at the bottom (so a new message never yanks you away from
 * something you're reading), and it holds your scroll position when older messages
 * load above.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentRunView, Message } from "@blob/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageRow } from "./MessageRow.tsx";
import { AgentRunCard } from "./AgentRunCard.tsx";
import { flashMessage } from "../../lib/navigation.ts";
import { useStore } from "../../lib/store.ts";
import { usePresence } from "../../lib/usePresence.ts";
import { EmptyState } from "../../components/EmptyState.tsx";

interface Props {
  /**
   * The conversation on screen — a channel id, or a thread's root id.
   *
   * Not rendered. It is how this component is told "that was a different conversation,
   * forget what you measured", which used to be said with `key=` on the element and
   * cannot be any more — see the reset effect below.
   */
  conversationId: string;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  onLoadOlder: () => void;
  onOpenThread: (rootId: string) => void;
  /** Messages after this id sit below the "New" divider. */
  unreadAfterId: string | null;
  emptyState?: React.ReactNode;
  inThread?: boolean;
  /** The last fetch failed; offer a retry instead of claiming the channel is new. */
  error?: boolean;
  onRetry?: () => void;
  /** Agent runs keyed by their trigger message, rendered under that message. */
  runsByMessageId?: Record<string, AgentRunView[]>;
}

/** Within this many pixels of the bottom counts as "at the bottom". */
const STICK_THRESHOLD = 120;

export function MessageList({
  conversationId,
  messages,
  hasMore,
  loading,
  onLoadOlder,
  onOpenThread,
  unreadAfterId,
  emptyState,
  inThread = false,
  error = false,
  onRetry,
  runsByMessageId,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [jumpBarDismissed, setJumpBarDismissed] = useState(false);
  /**
   * The one row in the list that is a tab stop.
   *
   * Null means "the last message", resolved at render so it follows the conversation
   * without an effect chasing it. Every row used to be `tabIndex={0}` along with each of
   * its six actions, so Tab cost seven presses per message and focusing a row below the
   * fold scrolled it into view and rendered more rows to walk — there was no number of
   * presses that reached the composer. Arrows move between rows, which is the affordance
   * that makes one tab stop enough.
   */
  const [tabStopId, setTabStopId] = useState<string | null>(null);
  const pendingScrollMessageId = useStore((s) => s.pendingScrollMessageId);
  const requestScrollToMessage = useStore((s) => s.requestScrollToMessage);

  // `null` is not "no divider" — it is the server saying nothing in this channel has
  // been read, which is what `lastReadMessageId` holds after marking the very first
  // message unread. Treating it as -1 made the divider vanish in the one case somebody
  // had just explicitly asked for it. Joining a channel sets a cursor at its newest
  // message, so this cannot fire for history you were never meant to have unread.
  // `null` stays "no divider", deliberately. It does mean "nothing read" after somebody
  // marks the very first message unread — but `openChannel` writes null just as readily
  // when the channel is not in `channels` yet (`?? null`), so it equally means "not
  // known". The two are indistinguishable here, and guessing "everything is unread"
  // hangs a "New messages" banner over a channel that is merely still loading — which a
  // test caught. Telling them apart needs a real sentinel, and that is a larger change
  // than this bug is worth.
  const firstUnreadIndex = useMemo(
    () =>
      unreadAfterId === null
        ? -1
        : messages.findIndex((message) => message.id > unreadAfterId),
    [messages, unreadAfterId],
  );
  const unreadCount =
    firstUnreadIndex === -1 ? 0 : messages.length - firstUnreadIndex;

  // Falls back to the newest message, and falls back again if the row it names has since
  // gone — an optimistic id replaced by the server's, or a page that scrolled away. A
  // tab stop that points at nothing is a list Tab skips entirely, which is the same bug
  // in the other direction.
  const effectiveTabStopId =
    tabStopId !== null && messages.some((m) => m.id === tabStopId)
      ? tabStopId
      : (messages[messages.length - 1]?.id ?? null);

  useEffect(() => {
    setJumpBarDismissed(false);
  }, [unreadAfterId]);

  const wasAtBottom = useRef(true);
  const previousMetrics = useRef({
    firstId: null as string | null,
    lastId: null as string | null,
    scrollHeight: 0,
  });

  const decoratedMessages = useMemo(
    () =>
      messages.map((message, index) => {
        const previous = index > 0 ? (messages[index - 1] as Message) : null;
        const day = dayKey(message.createdAt);
        const previousDay = previous ? dayKey(previous.createdAt) : null;
        const showDay = previousDay !== day;
        // The first row can be the divider. Requiring a previous message meant that
        // when the whole loaded page was unread — you were away, fifty messages
        // arrived, and the page begins after your cursor — the jump bar offered "50 new
        // messages" and scrolled to a row with no marker on it. The divider went
        // missing in exactly the case with the most unread in it.
        const isFirstUnread =
          unreadAfterId !== null &&
          message.id > unreadAfterId &&
          (previous === null || previous.id <= unreadAfterId);

        return {
          message,
          previous,
          showDay,
          isFirstUnread,
        };
      }),
    [messages, unreadAfterId],
  );

  // TanStack Virtual is the intended virtualization layer here; React's compiler rule
  // flags the hook generically even when the usage is correct.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: decoratedMessages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) =>
      decoratedMessages[index]?.message.id ?? `row-${index}`,
    // Close to what rows actually measure — 47px on average in a channel, less in a
    // thread. It was 120/148, which made the virtualizer think a 32-message channel
    // was 4,700px tall when it was 1,500, and everything keyed on scrollHeight before
    // measurement was wrong by the difference. Day / unread dividers add a strip of
    // extra height; guessing those as the same 52px as a grouped row is how a window
    // of measured rows left 20–40px holes above the next one.
    estimateSize: (index) => {
      const row = decoratedMessages[index];
      let size = inThread ? 44 : 52;
      if (row?.showDay) size += 36;
      if (row?.isFirstUnread) size += 28;
      return size;
    },
    // getBoundingClientRect, not offsetHeight: the latter rounds and used to miss the
    // 6px group-start padding, which is exactly the stripe of empty space between rows.
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 12,
  });

  /**
   * A different conversation: forget everything measured about the last one.
   *
   * This was `key={channelId}` on the element in `ChannelView` (and `key={rootId}` in
   * `ThreadPanel`), which is the ordinary React way to say it — and it leaked. React
   * unmounted the old list and left its DOM behind, so every channel switch added
   * another `.message-list` to the pane: six switches, six lists, every one of them
   * still laid out and painted on every frame while only the newest was live. Measured
   * on 2026-09-14 against a production build with 671 messages in the channel: 236 DOM
   * nodes became 3,209 after six switches, and the click that switched channel took
   * 772 ms — 383 ms of script and 387 ms of presentation, both growing with each one.
   * The `.message-list` count stayed at one the moment the key came off.
   *
   * So the reset is done by hand, which is also more honest about what the key was for:
   * the measurement cache, the stick-to-bottom flag and the two pieces of per-list UI
   * state. `measure()` clears the virtualizer's `itemSizeCache` — the whole reason the
   * key was there, because a channel switch that kept the previous channel's row
   * heights left holes between rows until you scrolled far enough to remeasure.
   *
   * It runs before the scroll effect below, which is declaration order and deliberate:
   * that effect reads `wasAtBottom` and `previousMetrics` on the same commit and would
   * otherwise mistake a new conversation for a prepended page of the old one.
   */
  const seenConversation = useRef(conversationId);
  useLayoutEffect(() => {
    // Not on mount: a fresh component already holds every one of these defaults, and
    // setting state here would spend a second render before the first paint.
    if (seenConversation.current === conversationId) return;
    seenConversation.current = conversationId;
    virtualizer.measure();
    wasAtBottom.current = true;
    previousMetrics.current = { firstId: null, lastId: null, scrollHeight: 0 };
    setJumpBarDismissed(false);
    setTabStopId(null);
    // `virtualizer` is a fresh object every render, so it cannot be a dependency —
    // the same reason the effect below says so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const previous = previousMetrics.current;
    const nextFirstId = messages[0]?.id ?? null;
    const nextLastId = messages[messages.length - 1]?.id ?? null;
    const prependedOlderPage =
      previous.firstId !== null &&
      previous.lastId !== null &&
      nextFirstId !== null &&
      nextLastId !== null &&
      previous.firstId !== nextFirstId &&
      previous.lastId === nextLastId &&
      node.scrollTop < STICK_THRESHOLD;

    if (pendingScrollMessageId !== null) {
      // A jump is pending. Sticking to the bottom here would race it and win, because
      // this runs on the same commit that first renders the page the jump asked for.
    } else if (prependedOlderPage && previous.scrollHeight > 0) {
      // Older page prepended: keep the reader looking at the same message.
      node.scrollTop += node.scrollHeight - previous.scrollHeight;
    } else if (wasAtBottom.current && messages.length > 0) {
      // Through the virtualizer, not `scrollTop = scrollHeight`. At this point rows
      // are still estimated, so scrollHeight is a guess; setting scrollTop to it lands
      // wherever the browser clamps once the real heights arrive, which is how opening
      // a busy channel dropped you into the middle of it. scrollToIndex keeps
      // adjusting as measurement comes in.
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }

    previousMetrics.current = {
      firstId: nextFirstId,
      lastId: nextLastId,
      scrollHeight: node.scrollHeight,
    };
    // `virtualizer` is deliberately not a dependency: TanStack returns a fresh object
    // every render, so listing it would turn an effect keyed on the message list into
    // one that runs on every render and re-pins the scroll while you are reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, pendingScrollMessageId]);

  /**
   * Carry out a pending jump: search results, `/m/<id>` permalinks, saved items.
   *
   * This has to happen here because the row is not in the DOM. `scrollToMessage` looked
   * the element up with `querySelector` and scrolled it into view, which was right until
   * the list was virtualized — after that only about twenty rows exist at a time, so the
   * lookup failed for every target that was not already on screen and the jump silently
   * became "open the channel at the bottom". The history was loaded correctly and
   * centred on the message the whole time; it just never got shown.
   *
   * Two passes. `scrollToIndex` puts the row in the rendered window, and only then can
   * the flash find an element to mark — so the highlight waits for the frame after.
   */
  useEffect(() => {
    if (pendingScrollMessageId === null) return undefined;
    const index = messages.findIndex((m) => m.id === pendingScrollMessageId);
    // Not in this list. A thread reply is not in channel history, so the panel beside us
    // is the one that will answer — leave the request standing for it.
    if (index === -1) return undefined;

    virtualizer.scrollToIndex(index, { align: "center" });
    const frame = requestAnimationFrame(() => {
      flashMessage(pendingScrollMessageId);
      requestScrollToMessage(null);
    });
    return () => cancelAnimationFrame(frame);
    // Same reasoning as above: `virtualizer` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScrollMessageId, messages, requestScrollToMessage]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;

    function onScroll() {
      const el = scrollRef.current;
      if (!el) return;
      wasAtBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      if (el.scrollTop < 200 && hasMore && !loading) onLoadOlder();
    }

    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [hasMore, loading, onLoadOlder]);

  const jumpBarOpen = unreadCount > 0 && !jumpBarDismissed && !inThread;

  if (messages.length === 0) {
    if (error) {
      return (
        <div className="message-list" ref={scrollRef}>
          <EmptyState
            title="Couldn’t load messages"
            action={
              onRetry && (
                <button type="button" className="btn btn-primary" onClick={onRetry}>
                  Try again
                </button>
              )
            }
          >
            The server didn’t answer. Nothing is lost.
          </EmptyState>
        </div>
      );
    }
    if (loading) {
      // A skeleton, not the empty state: "This is the start of #channel" is a claim
      // about history, and while the fetch is in flight nobody knows yet.
      return (
        <div className="message-list" ref={scrollRef} aria-busy="true">
          <div className="message-skeleton">
            {[72, 55, 84, 40, 66].map((width, index) => (
              <div key={index} className="message-skeleton-row">
                <span className="message-skeleton-avatar" />
                <span className="message-skeleton-lines">
                  <span
                    className="message-skeleton-line"
                    style={{ width: "120px" }}
                  />
                  <span
                    className="message-skeleton-line"
                    style={{ width: `${width}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (emptyState) {
      return (
        <div className="message-list" ref={scrollRef}>
          {emptyState}
        </div>
      );
    }
  }

  return (
    <div
      className="message-list"
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {/* Keyed by the conversation, which is what stops one channel's bar from finishing
          its exit over the next channel's messages: a switch mounts a new bar, and a new
          bar that is not open has nothing to leave and renders nothing. The rest of this
          list resets by hand on `conversationId` (see above) because it must keep its DOM
          node; the bar has no such constraint, so it gets the key. */}
      <UnreadJumpBar
        key={conversationId}
        open={jumpBarOpen}
        count={unreadCount}
        onJump={() => {
          const target = messages[firstUnreadIndex];
          if (!target) return;
          virtualizer.scrollToIndex(firstUnreadIndex, { align: "center" });
        }}
        onDismiss={() => setJumpBarDismissed(true)}
      />
      {hasMore && (
        <div style={{ padding: "8px 22px" }}>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={onLoadOlder}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load earlier messages"}
          </button>
        </div>
      )}

      <div
        className="message-list-viewport"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const { message, previous, showDay, isFirstUnread } =
            decoratedMessages[item.index]!;

          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="message-list-row"
              style={{ transform: `translate3d(0, ${item.start}px, 0)` }}
            >
              {showDay && (
                <div className="day-divider">
                  <span>{dayLabel(message.createdAt)}</span>
                </div>
              )}
              {isFirstUnread && (
                <div className="unread-divider">
                  <span>New</span>
                </div>
              )}
              <MessageRow
                message={message}
                previous={showDay || isFirstUnread ? null : previous}
                onOpenThread={onOpenThread}
                inThread={inThread}
                isTabStop={message.id === effectiveTabStopId}
                onFocusRow={setTabStopId}
              />
              {runsByMessageId?.[message.id]?.map((run) => (
                <AgentRunCard key={run.id} run={run} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "N new messages — jump", at the top of a conversation you have not caught up with.
 *
 * A component of its own for two reasons, both about leaving. It holds itself through
 * one exit with `usePresence`, which takes a ref and a hook — and it keeps the count it
 * was showing while it goes, because `unreadCount` is already 0 by the time the channel
 * has been read out from under it and "0 new messages" fading away is worse than no exit
 * at all. Keeping both here rather than in the list is what lets the caller throw the
 * whole thing away with a key when the conversation changes; held in the list, they
 * survived the switch and the next channel inherited the last one's exit and its number.
 */
function UnreadJumpBar({
  open,
  count,
  onJump,
  onDismiss,
}: {
  open: boolean;
  count: number;
  onJump: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { present, state } = usePresence(open, ref);
  const [held, setHeld] = useState(count);
  if (open && held !== count) setHeld(count);

  if (!present) return null;

  return (
    // `inert` while it leaves, not merely `pointer-events: none`: the pointer is only one
    // way in. Without it a bar on its way out keeps two buttons in the tab order and its
    // text in the accessibility tree, offering a jump to a conversation that has been read.
    <div
      className="unread-jump-bar"
      ref={ref}
      data-state={state}
      inert={state === "closed"}
    >
      <button type="button" className="unread-jump-action" onClick={onJump}>
        {held === 1 ? "1 new message" : `${held} new messages`} — jump
      </button>
      <button
        type="button"
        className="unread-jump-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}
