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

interface Props {
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

  const firstUnreadIndex = useMemo(
    () =>
      unreadAfterId === null
        ? -1
        : messages.findIndex((message) => message.id > unreadAfterId),
    [messages, unreadAfterId],
  );
  const unreadCount = firstUnreadIndex === -1 ? 0 : messages.length - firstUnreadIndex;

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
        const isFirstUnread =
          unreadAfterId !== null && previous !== null
            ? previous.id <= unreadAfterId && message.id > unreadAfterId
            : false;

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
    // measurement was wrong by the difference.
    estimateSize: () => (inThread ? 44 : 52),
    overscan: 10,
  });

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

    if (prependedOlderPage && previous.scrollHeight > 0) {
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
  }, [messages]);

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

  if (messages.length === 0) {
    if (error) {
      return (
        <div className="message-list" ref={scrollRef}>
          <div className="empty-state">
            <div className="empty-state-title">Couldn’t load messages</div>
            <div className="empty-state-body">The server didn’t answer. Nothing is lost.</div>
            {onRetry && (
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
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
                  <span className="message-skeleton-line" style={{ width: "120px" }} />
                  <span className="message-skeleton-line" style={{ width: `${width}%` }} />
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
      {unreadCount > 0 && !jumpBarDismissed && !inThread && (
        <div className="unread-jump-bar">
          <button
            type="button"
            className="unread-jump-action"
            onClick={() => {
              const target = messages[firstUnreadIndex];
              if (!target) return;
              virtualizer.scrollToIndex(firstUnreadIndex, { align: "center" });
            }}
          >
            {unreadCount === 1 ? "1 new message" : `${unreadCount} new messages`} — jump
          </button>
          <button
            type="button"
            className="unread-jump-dismiss"
            aria-label="Dismiss"
            onClick={() => setJumpBarDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
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
              style={{ transform: `translateY(${item.start}px)` }}
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
