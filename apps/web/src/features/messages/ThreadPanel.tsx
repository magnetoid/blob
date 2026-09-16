/** The right panel's thread view: root message plus its replies and agentic helpers. */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentRunView } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";
import { draftKey } from "../../lib/drafts.ts";
import { closeThread } from "../../lib/navigation.ts";
import { useFetch } from "../../lib/useFetch.ts";
import { usePresence, type PresenceState } from "../../lib/usePresence.ts";
import { byDisplayName } from "../../lib/format.ts";
import { useMentionIndex } from "./mentionIndex.ts";
import { MessageList } from "./MessageList.tsx";
import { Composer } from "./Composer.tsx";
import { ThreadSummaryCard } from "./ThreadSummary.tsx";
import { ThreadTasksCard } from "./ThreadTasks.tsx";
import { useThreadTools } from "./threadTools.ts";
import { CloseIcon } from "../../components/Icon.tsx";

/**
 * Follow, or stop following, the thread on screen.
 *
 * Replying subscribed you and nothing could unsubscribe you: `thread_subscriptions.muted`
 * has been on the table since the first migration and no code ever wrote it, so the only
 * escape from a thread you had once answered was muting the whole channel. This is both
 * halves — the control, and the way to follow one you have not replied in.
 */
function FollowToggle({ rootId }: { rootId: string }) {
  // A panel that cannot answer "are you following this?" says nothing rather than
  // claim either answer: on a failed load `data` stays null and so does the button.
  const { data } = useFetch(() => api.messages.threadFollowing(rootId), [rootId]);
  const [override, setOverride] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const following = override ?? data?.following ?? null;

  // Opening a thread is how you read it, so the cursor moves here. It does not
  // subscribe you: looking is not asking to be told about it for ever.
  useEffect(() => {
    void api.messages.markThreadRead(rootId).catch(() => {});
  }, [rootId]);

  if (following === null) return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !following;
    setOverride(next);
    try {
      await api.messages.followThread(rootId, next);
    } catch (err) {
      setOverride(!next);
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="btn btn-ghost thread-follow"
      aria-pressed={following}
      disabled={busy}
      onClick={() => void toggle()}
      title={
        following
          ? "You are told about new replies here"
          : "Be told about new replies here"
      }
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

export function ThreadPanel({
  rootId,
  panelRef,
  state,
}: {
  rootId: string;
  /** The element that animates away; `ThreadPanelSlot` watches it for `animationend`. */
  panelRef?: RefObject<HTMLElement | null>;
  /** `open` or `closed`, straight onto the root for the stylesheet to key the exit off. */
  state?: PresenceState;
}) {
  const thread = useStore((s) => s.threads[rootId]);
  const channels = useStore((s) => s.channels);
  const currentUser = useStore((s) => s.currentUser);
  const users = useStore((s) => s.users);
  const channelTitle = useStore((s) => s.channelTitle);
  const customEmoji = useStore((s) => s.customEmoji);
  const knownNames = useMentionIndex();
  // The summary's text is rendered like a message: a model writes @names and bullets.
  const renderOptions = useMemo(
    () => ({ knownNames, currentUserId: currentUser?.id ?? null, customEmoji }),
    [knownNames, currentUser, customEmoji],
  );
  const tools = useThreadTools(rootId);

  // Slack opens a thread straight into root → replies → composer; the agentic cards are
  // this panel's departure from that, so they collapse behind a toggle by default.
  const [toolsOpen, setToolsOpen] = useState(() => {
    // localStorage can throw (private windows, blocked site data); default collapsed.
    try {
      return localStorage.getItem("blob.threadTools") === "open";
    } catch {
      return false;
    }
  });

  const [alsoSend, setAlsoSend] = useState(false);
  // The send wrapper below runs outside render and needs the current checkbox value.
  const agentRuns = useStore((s) => s.agentRuns);
  const runsByMessageId = useMemo(() => {
    const map: Record<string, AgentRunView[]> = {};
    for (const run of Object.values(agentRuns)) {
      if (run.threadRootId !== rootId || !run.triggerMessageId) continue;
      (map[run.triggerMessageId] ??= []).push(run);
    }
    return map;
  }, [agentRuns, rootId]);

  const alsoSendRef = useRef(alsoSend);
  useEffect(() => {
    alsoSendRef.current = alsoSend;
  }, [alsoSend]);

  const root = thread?.[0];
  const channel = root ? channels[root.channelId] : undefined;
  const replyCount = Math.max((thread?.length ?? 1) - 1, 0);
  const canManageAssignments = currentUser?.role !== "member";
  const channelLabel = channel
    ? channel.name
      ? `#${channel.name}`
      : channelTitle(channel)
    : "";

  const toolsHintParts: string[] = [];
  if (!tools.loading && tools.summary) toolsHintParts.push("summary");
  if (!tools.loading && tools.tasks.length > 0) {
    toolsHintParts.push(
      `${tools.tasks.length} ${tools.tasks.length === 1 ? "task" : "tasks"}`,
    );
  }
  const toolsHint = toolsHintParts.join(" · ");

  const assignees = useMemo(
    () =>
      Object.values(users)
        .filter((user) => !user.deactivated)
        .filter((user) => canManageAssignments || user.kind !== "bot")
        .sort(byDisplayName),
    [canManageAssignments, users],
  );

  function toggleTools() {
    setToolsOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("blob.threadTools", next ? "open" : "closed");
      } catch {
        // Persistence is a convenience; the toggle still works without it.
      }
      return next;
    });
  }

  return (
    // `inert` while it leaves, not merely `pointer-events: none`: the pointer is only
    // one way in. Without it a panel on its way out keeps its close button, its follow
    // toggle, its composer and every message link in the tab order, and its landmark in
    // the accessibility tree, for a thread that has been closed.
    <aside
      className="panel"
      aria-label="Thread"
      ref={panelRef}
      data-state={state}
      inert={state === "closed"}
    >
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Thread</h2>
          <div className="panel-sub">
            {channelLabel}
            {replyCount > 0 &&
              ` · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
          </div>
        </div>
        <FollowToggle key={rootId} rootId={rootId} />
        <button
          className="icon-btn"
          onClick={() => closeThread()}
          title="Close thread"
        >
          <CloseIcon size="md" />
        </button>
      </div>

      <div className="agentic-stack">
        <button
          className="btn btn-ghost"
          onClick={toggleTools}
          aria-expanded={toolsOpen}
        >
          {toolsOpen ? "Hide thread tools" : "Thread tools"}
          {!toolsOpen && toolsHint !== "" && (
            <span className="muted">{` · ${toolsHint}`}</span>
          )}
        </button>

        {toolsOpen && (
          <>
            <ThreadSummaryCard
              rootId={rootId}
              summary={tools.summary}
              loading={tools.loading}
              error={tools.error}
              renderOptions={renderOptions}
              users={users}
              onRefreshed={(summary) => tools.apply({ type: "summary", summary })}
            />
            <ThreadTasksCard
              rootId={rootId}
              tasks={tools.tasks}
              loading={tools.loading}
              error={tools.error}
              summaryId={tools.summary?.id ?? null}
              assignees={assignees}
              canManageAssignments={canManageAssignments}
              users={users}
              apply={tools.apply}
            />
          </>
        )}
      </div>

      <MessageList
        conversationId={rootId}
        messages={thread ?? []}
        runsByMessageId={runsByMessageId}
        hasMore={false}
        loading={!thread}
        onLoadOlder={() => {}}
        onOpenThread={() => {}}
        unreadAfterId={null}
        inThread
      />

      {root && (
        <>
          <label className="muted thread-also-send">
            <input
              type="checkbox"
              checked={alsoSend}
              onChange={(event) => setAlsoSend(event.target.checked)}
            />
            <span>Also send to {channelLabel || "channel"}</span>
          </label>
          <Composer
            // Same reason as ChannelView: switching threads left the previous one's
            // attachments in the tray.
            key={draftKey(root.channelId, rootId)}
            channelId={root.channelId}
            threadRootId={rootId}
            placeholder="Reply in thread"
            initialFocus
            consumeAlsoInChannel={() => {
              const ticked = alsoSendRef.current;
              // Slack's contract: the tick applies to the one message being sent.
              if (ticked) setAlsoSend(false);
              return ticked;
            }}
          />
        </>
      )}
    </aside>
  );
}

/**
 * The panel's mounting envelope: what keeps it in the DOM long enough to leave.
 *
 * Two things have to be held, not one. `usePresence` holds the node for a single exit —
 * without it React drops the panel on the render that closed the thread and there is
 * nothing left to animate. And the root id is held with it: `activeThreadRootId` is null
 * the moment the thread closes, so a panel still rendering from it would spend its exit
 * as an empty panel with no messages, no reply count and no channel name. State rather
 * than a ref, adjusted during render rather than in an effect, for the reason
 * `usePresence` gives for its own: an effect lands a commit later, one frame too late.
 *
 * `onPresence` is what the shell listens to. `.shell[data-panel="open"]` is what gives
 * the panel its grid column — and, under 900px, its fixed position — so the column has
 * to outlast the exit, or the last 150ms plays on a panel the layout has already taken
 * the ground out from under.
 */
export function ThreadPanelSlot({
  rootId,
  onPresence,
}: {
  /** The thread to show, or null: closed, and time to leave. */
  rootId: string | null;
  onPresence?: (present: boolean) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const { present, state } = usePresence(rootId !== null, panelRef);
  const [held, setHeld] = useState(rootId);
  if (rootId !== null && rootId !== held) setHeld(rootId);

  // Through a ref, so the effect below depends on `present` alone. Workspace passes a
  // setState function and nothing changes, but a caller passing an inline lambda would
  // give the effect a new dependency every render — and this effect's cleanup *reports*,
  // so every render would say "gone" and then "here" again.
  const report = useRef(onPresence);
  useEffect(() => {
    report.current = onPresence;
  }, [onPresence]);

  useEffect(() => {
    report.current?.(present);
    // Reported on the way out as well: a slot unmounted outright — the terminal taking
    // the column, the view changing — has no exit to finish and must not leave the shell
    // holding a column for a panel that is no longer there.
    return () => report.current?.(false);
  }, [present]);

  if (!present || held === null) return null;

  return <ThreadPanel rootId={held} panelRef={panelRef} state={state} />;
}
