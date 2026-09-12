/** The centre pane: channel header, messages, composer. */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentRunView } from "@blob/shared";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";
import { draftKey } from "../../lib/drafts.ts";
import { typingKey } from "../../lib/typing.ts";
import { scrollToMessage } from "../../lib/navigation.ts";
import { api } from "../../lib/api.ts";
import { showThread } from "../../lib/navigation.ts";
import { navigate } from "../../lib/router.ts";
import { MessageList } from "./MessageList.tsx";
import { Composer } from "./Composer.tsx";
import {
  ChevronDownIcon,
  HuddleIcon,
  MembersIcon,
  PinIcon,
} from "../../components/Icon.tsx";
import { PinnedPanel } from "./PinnedPanel.tsx";
import { CatchUpStrip } from "./CatchUpStrip.tsx";
import { ChannelMenu } from "../channels/ChannelMenu.tsx";
import { ChannelDetails } from "../channels/ChannelDetails.tsx";
import { WorkPanel, WorkTabs, type WorkTab } from "../work/WorkPanel.tsx";
import { useWork } from "../work/useWork.ts";
import { TYPING_TTL_MS } from "@blob/shared";
import { memberSummary } from "./memberSummary.ts";
import { EmptyState } from "../../components/EmptyState.tsx";

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
    s.activeChannelId ? s.typing[typingKey(s.activeChannelId)] : undefined,
  );
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const status = useStore((s) => s.status);
  const unreadMarkers = useStore((s) => s.unreadMarkers);
  const loadOlder = useStore((s) => s.loadOlder);
  const openChannel = useStore((s) => s.openChannel);
  const requestScrollToMessage = useStore((s) => s.requestScrollToMessage);
  const agentRuns = useStore((s) => s.agentRuns);
  // The work behind this channel, if it is a work channel (ADR 0014). A hook, so it
  // sits above the early returns like every other one here.
  const { work, artifacts } = useWork(
    activeChannelId ?? "",
    channel?.workId ?? null,
  );

  // Runs anchored under their trigger. Thread replies carry threadRootId and anchor in
  // the thread panel instead — the trigger row is not in channel history there.
  const runsByMessageId = useMemo(() => {
    if (!activeChannelId) return undefined;
    const map: Record<string, AgentRunView[]> = {};
    for (const run of Object.values(agentRuns)) {
      if (
        run.channelId !== activeChannelId ||
        run.threadRootId ||
        !run.triggerMessageId
      ) {
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
  // Which tab each work channel is on, keyed by channel so switching channels never
  // shows one channel's Changes over another's conversation. No effect needed to reset.
  const [workTabs, setWorkTabs] = useState<Record<string, WorkTab>>({});

  /**
   * Bring a pinned message into view.
   *
   * A pin is very often older than the loaded page, so this fetches the page around it
   * before trying to show it. The showing is left to `MessageList`: the list is
   * virtualized, so a row that is not already on screen has no element to scroll to and
   * will not have one until something scrolls to its *index*. Looking it up in the DOM
   * on the next frame — which is what this did — found nothing every time, so the common
   * case was a click that closed the panel, loaded the right page, and left you at the
   * bottom of the channel.
   */
  async function jumpToMessage(messageId: string) {
    if (scrollToMessage(messageId) || !activeChannelId) return;
    await openChannel(activeChannelId, messageId);
    requestScrollToMessage(messageId);
  }

  // The ids rather than their count: the header names people and agents separately, and
  // which of the two a member is can only be answered by looking each one up.
  const [memberIds, setMemberIds] = useState<Record<string, string[]>>({});
  const [dismissedCatchUp, setDismissedCatchUp] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [now, setNow] = useState(() => Date.now());

  // Typing indicators expire on a timer rather than an event, so re-render slowly.
  useEffect(() => {
    if (!typing || Object.keys(typing).length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  const typingNames = useMemo(() => {
    if (!typing) return [];
    return Object.entries(typing)
      .filter(([id, startedAt]) => id !== currentUser?.id && now - startedAt < TYPING_TTL_MS)
      .map(([id]) => users[id]?.displayName ?? "Someone")
      .filter((name, i, all) => all.indexOf(name) === i);
  }, [typing, currentUser, users, now]);

  const membershipVersion = useStore((s) =>
    s.activeChannelId ? (s.membershipVersion[s.activeChannelId] ?? 0) : 0,
  );
  const memberCountKey = activeChannelId
    ? `${activeChannelId}:${membershipVersion}`
    : null;

  useEffect(() => {
    if (!activeChannelId || !memberCountKey || memberIds[memberCountKey] !== undefined)
      return;
    void api.channels
      .members(activeChannelId)
      .then((r) =>
        setMemberIds((current) =>
          current[memberCountKey] ? current : { ...current, [memberCountKey]: r.userIds },
        ),
      )
      .catch(() => {});
  }, [activeChannelId, memberCountKey, memberIds]);

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
  const reportMembers = useCallback(
    (userIds: string[]) => {
      if (!memberCountKey) return;
      setMemberIds((current) => ({ ...current, [memberCountKey]: userIds }));
    },
    [memberCountKey],
  );

  const activeMeetup = useStore((s) => 
    activeChannelId ? Object.values(s.activeMeetups).find(m => m.channelId === activeChannelId) : undefined
  );

  const handleStartMeetup = useCallback(async () => {
    const state = useStore.getState();
    const activeChannelId = state.activeChannelId;
    const channel = activeChannelId ? state.channels[activeChannelId] : undefined;
    if (!activeChannelId || !channel) return;

    const activeMeetup = Object.values(state.activeMeetups).find(
      (m) => m.channelId === activeChannelId,
    );
    if (activeMeetup) {
      navigate(`/meetup/${activeMeetup.id}`);
      return;
    }
    try {
      const title = channel.name ?? useStore.getState().channelTitle(channel);
      const meetup = await api.meetups.create({
        name: `Meetup in ${title}`,
        channelId: activeChannelId,
      });
      navigate(`/meetup/${meetup.id}`);
    } catch (err: unknown) {
      showError(err);
    }
  }, []);

  if (!activeChannelId || !channel) {
    return (
      <main className="pane">
        <EmptyState mark="#" title="Pick a conversation">Choose a channel or a person on the left to start reading.</EmptyState>
      </main>
    );
  }

  const archived = channel.archivedAt !== null;
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

  const workTab: WorkTab = channel.workId
    ? (workTabs[activeChannelId] ?? "conversation")
    : "conversation";
  const members = memberCountKey ? (memberIds[memberCountKey] ?? null) : null;
  const memberCount = members?.length ?? null;
  const agentCount = members?.filter((id) => users[id]?.kind === "bot").length ?? 0;
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
    <main className="pane">
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
              {agent && <span className="agent-badge">Agent</span>}
              {channel.membership?.isStarred && (
                <span className="pane-star" title="Starred">
                  ★
                </span>
              )}
              <ChevronDownIcon size="sm" />
            </button>
          </div>
          {/* An agent's room says what the agent is rather than that this is a DM, which
              the avatar and the badge have already said. The sentence is the one thing
              about an agent that is true of every one of them and that nobody guesses
              right: a run you start carries *your* authority, so it reads what you could
              have read and nothing further (ADR 0013, and ADR 0016 for the same rule
              reached over MCP). Stated here because this is the room where people ask an
              agent to go and look at things. */}
          <div className="pane-sub">
            {agent
              ? (channel.topic ??
                "Acts with your permissions — it can reach exactly what you can reach.")
              : channel.topic || (isDm ? "Direct message" : "No topic set")}
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
          title={activeMeetup ? "Join active meetup" : "Start a meetup"}
          data-active={activeMeetup ? "true" : "false"}
          onClick={handleStartMeetup}
        >
          <HuddleIcon size="md" />
          <span className="pane-action-label">
            {activeMeetup ? "Join Meetup" : "Meetup"}
          </span>
        </button>
        <button
          className="btn btn-ghost"
          title="Summarise what you haven't read here"
          onClick={() => useStore.setState({ catchupScope: "channel" })}
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
            <PinIcon size="md" />
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
        {/* "14 members · 3 agents". Two numbers rather than one, because a workspace
            where some members are programs is the thing this product is, and a single
            total hides it. The agents half is omitted when there are none — a channel
            with no agent in it should not be made to mention them.
            Deliberately *not* iris: that colour is reserved for things an agent wrote
            (see tokens.css), and a count of who is in a room is not authorship. */}
        <button
          className="btn btn-ghost pane-members"
          title={isDm ? "Who is in this conversation" : "Members"}
          disabled={isDm}
          onClick={() => setDetailsOpen(true)}
        >
          <MembersIcon size="md" />
          <span className="pane-members-count">
            {memberSummary(memberCount, agentCount)}
          </span>
        </button>
      </header>

      {detailsOpen && !isDm && (
        <ChannelDetails
          channel={channel}
          onClose={() => setDetailsOpen(false)}
          onMembers={reportMembers}
        />
      )}

      {showDeliveryBanner && connectionText && (
        <div className="connection-banner">{connectionText}</div>
      )}

      {/* Dismissal is per channel and lives only as long as this session. A backlog you
          waved away is not a preference worth storing, and the strip disappears on its
          own as soon as the channel is read. */}
      {!dismissedCatchUp.has(activeChannelId) && (
        <CatchUpStrip
          hasUnread={Boolean(channel.hasUnread)}
          mentionCount={channel.mentionCount ?? 0}
          onDismiss={() =>
            setDismissedCatchUp((current) => new Set(current).add(activeChannelId))
          }
        />
      )}

      {archived && (
        <div className="pinned-bar">
          <PinIcon size="sm" />
          <span className="pinned-label">Archived</span>
          <span>This channel is read-only. Its history stays searchable.</span>
        </div>
      )}

      {channel.workId && (
        <WorkTabs
          tab={workTab}
          onChange={(next) =>
            setWorkTabs((current) => ({ ...current, [activeChannelId]: next }))
          }
          work={work}
          artifacts={artifacts}
        />
      )}

      {workTab !== "conversation" && channel.workId ? (
        <WorkPanel
          tab={workTab}
          channelId={activeChannelId}
          work={work}
          artifacts={artifacts}
        />
      ) : (
        <>
          <MessageList
            // Keyed to the conversation so the virtualizer does not keep the previous
            // channel's measured heights. That cache is how switching chats left holes
            // between rows until you scrolled far enough to remeasure.
            key={activeChannelId}
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
              <EmptyState mark={isDm ? "@" : "#"} title={<>This is the start of {isDm ? title : `#${title}`}</>}>
                {agent
                  ? `Ask ${agent.displayName} anything — no need to mention it by name here. It can see this conversation and nothing else in the workspace yet.`
                  : isDm
                    ? "Say hello. Nobody else can see this conversation."
                    : "No messages yet. Set a topic so people know what belongs here, or invite the folks who should be in the loop."}
              </EmptyState>
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
              // Keyed to the conversation. Only the prop changed on a channel switch, so the
              // composer's local state survived it — and an attachment that had finished
              // uploading in #general was still in the tray, and still sent, after clicking
              // #random. The draft text switched correctly because it is keyed per channel in
              // the store, which is exactly what hid the mismatch.
              key={draftKey(activeChannelId, null)}
              channelId={activeChannelId}
              /* The design writes this as "Message #launch-metrics — @ mentions a
                 person or an agent", and the second half is the part worth having: an
                 agent is reached by @name exactly like a colleague, and nothing else on
                 this screen says so. Only where it is true — a DM with an agent is
                 already the agent's room and says "no need to mention it by name here",
                 and a channel with no agent in it should not advertise one. */
              placeholder={
                isDm
                  ? `Message ${title}`
                  : agentCount > 0
                    ? `Message #${title} — @ mentions a person or an agent`
                    : `Message #${title}`
              }
            />
          )}
        </>
      )}
    </main>
  );
}
