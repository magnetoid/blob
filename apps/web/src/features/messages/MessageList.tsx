/**
 * The scrolling message list.
 *
 * Two behaviours matter here and are easy to get wrong: it sticks to the bottom only
 * when you are already at the bottom (so a new message never yanks you away from
 * something you're reading), and it holds your scroll position when older messages
 * load above.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';

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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);
  const previousHeight = useRef(0);
  const previousCount = useRef(0);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const grewAtTop = messages.length > previousCount.current && node.scrollTop < STICK_THRESHOLD;

    if (grewAtTop && previousHeight.current > 0) {
      // Older page prepended: keep the reader looking at the same message.
      node.scrollTop = node.scrollHeight - previousHeight.current;
    } else if (wasAtBottom.current) {
      node.scrollTop = node.scrollHeight;
    }

    previousHeight.current = node.scrollHeight;
    previousCount.current = messages.length;
  }, [messages]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;

    function onScroll() {
      const el = scrollRef.current;
      if (!el) return;
      wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      if (el.scrollTop < 200 && hasMore && !loading) onLoadOlder();
    }

    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [hasMore, loading, onLoadOlder]);

  if (messages.length === 0 && emptyState) {
    return (
      <div className="message-list" ref={scrollRef}>
        {emptyState}
      </div>
    );
  }

  let lastDay = '';

  return (
    <div className="message-list" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions">
      {hasMore && (
        <div style={{ padding: '8px 22px' }}>
          <button className="btn btn-ghost" onClick={onLoadOlder} disabled={loading}>
            {loading ? 'Loading…' : 'Load earlier messages'}
          </button>
        </div>
      )}

      {messages.map((message, index) => {
        const previous = index > 0 ? (messages[index - 1] as Message) : null;
        const day = dayKey(message.createdAt);
        const showDay = day !== lastDay;
        if (showDay) lastDay = day;

        const isFirstUnread =
          unreadAfterId !== null && previous !== null
            ? previous.id <= unreadAfterId && message.id > unreadAfterId
            : false;

        return (
          <div key={message.id}>
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
          </div>
        );
      })}
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

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}
