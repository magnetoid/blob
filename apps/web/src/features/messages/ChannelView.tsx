/** The centre pane: channel header, messages, composer. */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentRunView } from "@blob/shared";
import { useStore } from "../../lib/store.ts";
import { scrollToMessage } from "../../lib/navigation.ts";
import { api } from "../../lib/api.ts";
import { showThread } from "../../lib/navigation.ts";
import { MessageList } from "./MessageList.tsx";
import { Composer } from "./Composer.tsx";
import {
  ChevronDownIcon,
  HuddleIcon,
  MembersIcon,
  PinIcon,
} from "../../components/Icon.tsx";
import { PinnedPanel } from "./PinnedPanel.tsx";
import { ChannelMenu } from "../channels/ChannelMenu.tsx";
import { ChannelDetails } from "../channels/ChannelDetails.tsx";
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
  const openChannel = useStore((s) => s.openChannel);
  const agentRuns = useStore((s) => s.agentRuns);

  // Runs anchored under their trigger. Thread replies carry threadRootId and anchor in
  // the thread panel instead — the trigger row is not in channel history there.
  const runsByMessageId = useMemo(() => {
    if (!activeChannelId) return undefined;
    const map: Record<string, AgentRunView[]> = {};
    for (const run of Object.values(agentRuns)) {
      if (run.channelId !== activeChannelId || run.threadRootId || !run.triggerMessageId) {
        continue;
      }
      (map[run.triggerMessageId] ??= []).push(run);
    }
    return map;
  }, [agentRuns, activeChannelId]);
  const channelTitle = useStore((s) => s.channelTitle);

  const [pinsOpen, setPinsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  /**
   * Bring a pinned message into view.
   *
   * This used to work only when the message was already rendered, and a pin is very
   * often older than the loaded page — so the common case was a click that closed the
   * panel and did nothing. Permalinks needed a page fetched *around* a message anyway,
   * so the pin jump now falls back to the same thing rather than giving up.
   */
  async function jumpToMessage(messageId: string) {
    if (scrollToMessage(messageId) || !activeChannelId) return;
    await openChannel(activeChannelId, messageId);
    // React has not committed the new list on the frame the fetch resolves.
    requestAnimationFrame(() => scrollToMessage(messageId));
  }

  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  // Typing indicators expire on a timer rather than an event, so re-render slowly.
  useEffect(() => {
    if (!typing || Object.keys(typing).length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  const membershipVersion = useStore(
    (s) => (s.activeChannelId ? (s.membershipVersion[s.activeChannelId] ?? 0) : 0),
  );
  useEffect(() => {
    // Version changes drop the cached count so the fetch below re-runs.
    if (!activeChannelId || membershipVersion === 0) return;
    setMemberCounts((current) => {
      if (current[activeChannelId] === undefined) return current;
      const rest = { ...current };
      delete rest[activeChannelId];
      return rest;
    });
  }, [activeChannelId, membershipVersion]);

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
    (rootId: string) => {
      if (activeChannelId) void showThread(activeChannelId, rootId);
    },
    [activeChannelId],
  );
  const handleLoadOlder = useCallback(() => {
    if (activeChannelId) void loadOlder(activeChannelId);
  }, [loadOlder, activeChannelId]);

  // Memoised because the details dialog fetches its list in an effect keyed on this.
  // An inline arrow would be a new function every render, re-running that effect and
  // fetching the member list on a loop.
  const reportMemberCount = useCallback(
    (count: number) => {
      if (!activeChannelId) return;
      setMemberCounts((current) =>
        current[activeChannelId] === count
          ? current
          : { ...current, [activeChannelId]: count },
      );
    },
    [activeChannelId],
  );

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
  // A one-to-one DM whose other member is a bot is the agent's room, and it needs a
  // different empty state: the standing one says "Nobody else can see this conversation",
  // which stops being true the moment the other participant is a model.
  const agent =
    channel.kind === "dm"
      ? (channel.memberIds ?? [])
          .filter((id) => id !== currentUser?.id)
          .map((id) => users[id])
          .find((u) => u?.kind === "bot")
      : undefined;
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
        <div style={{ minWidth: 0, position: "relative" }}>
          <div className="pane-heading">
            {/* Slack puts the channel's own actions behind its name, and that is
                where a hand goes looking. Everything in here — mute, star, topic,
                who is in it, leaving — had a route and no control. */}
            <button
              className="pane-name-trigger"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
            >
              {!isDm && (
                <span className="pane-prefix" aria-hidden="true">
                  #
                </span>
              )}
              <h1 className="pane-title">{title}</h1>
              {channel.membership?.isStarred && (
                <span className="pane-star" title="Starred">
                  ★
                </span>
              )}
              <ChevronDownIcon size={13} strokeWidth={2} />
            </button>
          </div>
          <div className="pane-sub">
            {channel.topic || (isDm ? "Direct message" : "No topic set")}
          </div>
          {menuOpen && (
            <ChannelMenu
              channel={channel}
              onClose={() => setMenuOpen(false)}
              onOpenDetails={() => setDetailsOpen(true)}
            />
          )}
        </div>

        <div className="pane-spacer" />

        <button
          className="btn pane-action-huddle"
          disabled
          title="Huddles arrive in a later release"
        >
          <HuddleIcon size={15} />
          <span className="pane-action-label">Huddle</span>
        </button>
        <button
          className="btn btn-ghost"
          title="Summarise what you haven't read here"
          onClick={() => useStore.setState({ catchupScope: 'channel' })}
        >
          Catch up
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
            <span className="pane-action-label">Pinned</span>
          </button>
          {pinsOpen && activeChannelId && (
            <PinnedPanel
              channelId={activeChannelId}
              onClose={() => setPinsOpen(false)}
              onJump={(id) => void jumpToMessage(id)}
            />
          )}
        </div>
        <button
          className="btn btn-ghost"
          title={isDm ? "Who is in this conversation" : "Members"}
          disabled={isDm}
          onClick={() => setDetailsOpen(true)}
        >
          <MembersIcon size={15} />
          {memberCount ?? "–"}
        </button>
      </header>

      {detailsOpen && !isDm && (
        <ChannelDetails
          channel={channel}
          onClose={() => setDetailsOpen(false)}
          onMemberCount={reportMemberCount}
        />
      )}

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
        runsByMessageId={runsByMessageId}
        error={messages?.error ?? false}
        onRetry={() => void openChannel(activeChannelId)}
        emptyState={
          <div className="empty-state">
            <div className="empty-state-mark">{isDm ? "@" : "#"}</div>
            <div className="empty-state-title">
              This is the start of {isDm ? title : `#${title}`}
            </div>
            <div className="empty-state-body">
              {agent
                ? `Ask ${agent.displayName} anything — no need to mention it by name here. It can see this conversation and nothing else in the workspace yet.`
                : isDm
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
