/** The centre pane: channel header, messages, composer. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store.ts";
import { api } from "../../lib/api.ts";
import { MessageList } from "./MessageList.tsx";
import { Composer } from "./Composer.tsx";
import { HuddleIcon, MembersIcon, PinIcon } from "../../components/Icon.tsx";
import { PinnedPanel } from "./PinnedPanel.tsx";
import { TYPING_TTL_MS } from "@blob/shared";

export function ChannelView() {
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channel = useStore((s) =>
    s.activeChannelId ? s.channels[s.activeChannelId] : undefined,
  );
  const messages = useStore((s) =>
    s.activeChannelId ? s.messages[s.activeChannelId] : undefined,
  );
  const outbox = useStore((s) => s.outbox);
  const typing = useStore((s) =>
    s.activeChannelId ? s.typing[s.activeChannelId] : undefined,
  );
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const status = useStore((s) => s.status);
  const unreadMarkers = useStore((s) => s.unreadMarkers);
  const loadOlder = useStore((s) => s.loadOlder);
  const openThread = useStore((s) => s.openThread);
  const channelTitle = useStore((s) => s.channelTitle);

  const [pinsOpen, setPinsOpen] = useState(false);

  /**
   * Bring a pinned message into view.
   *
   * Only works when it is on screen already — a pin can be older than the loaded page,
   * and paging back to find it is a different feature. When it is not there the panel
   * simply closes, which is honest; flashing an error for "that message is further up"
   * would be worse than nothing.
   */
  function jumpToMessage(messageId: string) {
    const node = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("message-flash");
    setTimeout(() => node.classList.remove("message-flash"), 1600);
  }

  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  // Typing indicators expire on a timer rather than an event, so re-render slowly.
  useEffect(() => {
    if (!typing || Object.keys(typing).length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  useEffect(() => {
    if (!activeChannelId || memberCounts[activeChannelId] !== undefined) return;
    void api.channels
      .members(activeChannelId)
      .then((r) =>
        setMemberCounts((current) =>
          current[activeChannelId] === r.userIds.length
            ? current
            : { ...current, [activeChannelId]: r.userIds.length },
        ),
      )
      .catch(() => {});
  }, [activeChannelId, memberCounts]);

  // Defined here, above the early return, because hooks have to be — and memoised
  // because `MessageRow` is wrapped in `memo` and these reach it as props. An arrow
  // written inline at the call site is a new function on every render, which makes that
  // comparison fail every time and re-renders every visible row. That was survivable
  // when the list rendered once; now that it virtualises, the parent re-renders on
  // scroll, so the wasted work lands exactly where it is felt.
  const handleOpenThread = useCallback(
    (rootId: string) => void openThread(rootId),
    [openThread],
  );
  const handleLoadOlder = useCallback(() => {
    if (activeChannelId) void loadOlder(activeChannelId);
  }, [loadOlder, activeChannelId]);

  const typingNames = useMemo(() => {
    if (!typing) return [];
    return Object.entries(typing)
      .filter(
        ([userId, at]) =>
          now - at < TYPING_TTL_MS && userId !== currentUser?.id,
      )
      .map(([userId]) => users[userId]?.displayName ?? "Someone");
  }, [typing, now, users, currentUser]);

  if (!activeChannelId || !channel) {
    return (
      <div className="pane">
        <div className="empty-state">
          <div className="empty-state-mark">#</div>
          <div className="empty-state-title">Pick a conversation</div>
          <div className="empty-state-body">
            Choose a channel or a person on the left to start reading.
          </div>
        </div>
      </div>
    );
  }

  const isDm = channel.kind === "dm" || channel.kind === "group_dm";
  const title = channel.name ?? channelTitle(channel);
  const archived = channel.archivedAt !== null;
  const memberCount = memberCounts[activeChannelId] ?? null;
  const queuedCount = Object.values(outbox).filter(
    (entry) => entry.status === "queued",
  ).length;
  const failedCount = Object.values(outbox).filter(
    (entry) => entry.status === "failed",
  ).length;
  const showDeliveryBanner =
    status !== "online" || queuedCount > 0 || failedCount > 0;

  let connectionText: string | null = null;
  if (status === "connecting") {
    connectionText =
      queuedCount > 0
        ? `Reconnecting… ${queuedCount} ${queuedCount === 1 ? "message is" : "messages are"} queued.`
        : "Reconnecting…";
  } else if (status !== "online") {
    connectionText =
      queuedCount > 0
        ? `Offline — ${queuedCount} ${queuedCount === 1 ? "message is" : "messages are"} queued to send when you reconnect.`
        : "Offline — new messages will queue until you reconnect.";
  } else if (failedCount > 0) {
    connectionText =
      failedCount === 1
        ? "One queued message needs attention before it can be sent."
        : `${failedCount} queued messages need attention before they can be sent.`;
  } else if (queuedCount > 0) {
    connectionText =
      queuedCount === 1
        ? "Sending one queued message…"
        : `Sending ${queuedCount} queued messages…`;
  }

  return (
    <div className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            {!isDm && (
              <span className="pane-prefix" aria-hidden="true">
                #
              </span>
            )}
            <h1 className="pane-title">{title}</h1>
          </div>
          <div className="pane-sub">
            {channel.topic || (isDm ? "Direct message" : "No topic set")}
          </div>
        </div>

        <div className="pane-spacer" />

        <button
          className="btn"
          disabled
          title="Huddles arrive in a later release"
        >
          <HuddleIcon size={15} />
          Huddle
        </button>
        <div style={{ position: "relative" }}>
          <button
            className="btn btn-ghost"
            title="Pinned messages"
            aria-expanded={pinsOpen}
            onClick={(event) => {
              // Stopped, or the panel's own capture-phase dismissal would close it on
              // the way down and this toggle would reopen it on the way back up.
              event.stopPropagation();
              setPinsOpen((open) => !open);
            }}
          >
            <PinIcon size={15} />
            Pinned
          </button>
          {pinsOpen && activeChannelId && (
            <PinnedPanel
              channelId={activeChannelId}
              onClose={() => setPinsOpen(false)}
              onJump={jumpToMessage}
            />
          )}
        </div>
        <button className="btn btn-ghost" title="Members">
          <MembersIcon size={15} />
          {memberCount ?? "–"}
        </button>
      </header>

      {showDeliveryBanner && connectionText && (
        <div className="connection-banner">{connectionText}</div>
      )}

      {archived && (
        <div className="pinned-bar">
          <PinIcon size={13} />
          <span className="pinned-label">Archived</span>
          <span>This channel is read-only. Its history stays searchable.</span>
        </div>
      )}

      <MessageList
        messages={messages?.items ?? []}
        hasMore={messages?.hasMore ?? false}
        loading={messages?.loading ?? false}
        onLoadOlder={handleLoadOlder}
        onOpenThread={handleOpenThread}
        unreadAfterId={unreadMarkers[activeChannelId] ?? null}
        emptyState={
          <div className="empty-state">
            <div className="empty-state-mark">{isDm ? "@" : "#"}</div>
            <div className="empty-state-title">
              This is the start of {isDm ? title : `#${title}`}
            </div>
            <div className="empty-state-body">
              {isDm
                ? "Say hello. Nobody else can see this conversation."
                : "No messages yet. Set a topic so people know what belongs here, or invite the folks who should be in the loop."}
            </div>
          </div>
        }
      />

      <div className="typing-line" aria-live="polite">
        {typingNames.length > 0 && (
          <span className="typing-dots">
            <i />
            <i />
            <i />
            <span className="typing-text">
              {typingNames.length === 1
                ? `${typingNames[0]} is typing…`
                : typingNames.length === 2
                  ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                  : "Several people are typing…"}
            </span>
          </span>
        )}
      </div>

      {!archived && (
        <Composer
          channelId={activeChannelId}
          placeholder={isDm ? `Message ${title}` : `Message #${title}`}
        />
      )}
    </div>
  );
}
