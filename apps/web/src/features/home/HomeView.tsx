/** The first screen: what needs you, what agents are doing, ask one.

 * Conversations stay in channels. This is the Slack home that Blob never had —
 * a live board, not a settings form, so a team that wants to move fast does not
 * start by hunting #general.
 */

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AgentRunView, AgentTask } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useRun, useRunIds } from '../../lib/useRuns.ts';
import { agentIsAvailable } from '../../lib/conversations.ts';
import { showChannel, showThread } from '../../lib/navigation.ts';
import { navigate } from '../../lib/router.ts';
import { showError } from '../../lib/toasts.ts';
import {
  FileIcon,
  MembersIcon,
  MentionIcon,
  SendIcon,
  SparkIcon,
} from '../../components/Icon.tsx';
import { AgentRunCard } from '../messages/AgentRunCard.tsx';
import { ListSkeleton } from '../../components/ListSkeleton.tsx';
import { formatRelative } from '../messages/messageFormatting.ts';
import { useFetch } from '../../lib/useFetch.ts';

export function HomeView() {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const channelTitle = useStore((s) => s.channelTitle);

  const [ask, setAsk] = useState('');
  const [sending, setSending] = useState(false);
  const { data: tasks } = useFetch(
    async (): Promise<AgentTask[]> =>
      (await api.agentic.listTasks(currentUser ? { assignee: currentUser.id } : {})).tasks,
    [currentUser?.id],
  );
  // Your runs, folded into the store the cards below read from — through the store's
  // fold, so a list fetched before a run finished cannot put it back to running.
  // Nothing renders the value itself; a failure changes nothing.
  useFetch(
    async () => {
      const { runs } = await api.agentRuns.mine();
      useStore.getState().foldRuns(runs);
      return runs;
    },
    [currentUser?.id],
  );

  const unread = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => c.membership && (c.hasUnread || (c.mentionCount ?? 0) > 0))
        .sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0)),
    [channels],
  );

  // Which runs are on the board, as ids: the board redraws when one joins or leaves a
  // list, and each row redraws itself as its run moves (`lib/useRuns.ts`).
  const me = currentUser?.id ?? null;
  const running = useRunIds((r) => r.status === 'running', oldestFirst);
  // Yours to decide: only the person a run is on behalf of may answer it, so somebody
  // else's question is not something that needs you, however visible its card is.
  const waiting = useRunIds(
    (r) => r.status === 'interrupted' && !r.answeredAt && me !== null && r.initiatedByUserId === me,
    oldestFirst,
  );
  const doneToday = useRunIds((r) => r.status === 'succeeded' && r.finishedAt !== null, newestFinished);
  const openTasks = (tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');

  const peopleHere = useMemo(
    () =>
      Object.values(users).filter(
        (u) => !u.deactivated && u.kind === 'human' && u.id !== currentUser?.id && presence[u.id] === 'active',
      ),
    [users, presence, currentUser],
  );

  // The first agent that can answer. There used to be a preference for one named
  // "Blob", the agent Blob ran itself; that agent is retired and the workspace's agent
  // is whichever is installed and available — Janus, where it is running.
  const agent = useMemo(() => {
    const usable = Object.values(users).filter((u) => u.kind === 'bot' && agentIsAvailable(u));
    // The resident one first. The roster is alphabetical, so "whichever bot is first"
    // may be somebody's own agent or an app that is not in #general — and a mention
    // there is dropped with no reply and no error, which reads as the agent being down.
    return usable.find((u) => u.agentResident) ?? usable[0];
  }, [users]);

  const askChannel = useMemo(
    () =>
      Object.values(channels).find((c) => c.name === 'general' && c.membership) ??
      Object.values(channels).find((c) => c.kind === 'public' && c.membership),
    [channels],
  );

  async function submitAsk(event: FormEvent) {
    event.preventDefault();
    const text = ask.trim();
    if (!text || sending) return;
    if (!agent || !askChannel) {
      showError(new Error('No workspace agent is installed yet.'));
      return;
    }
    setSending(true);
    try {
      const tagged = new RegExp(`@${agent.displayName}\\b`, 'i').test(text)
        ? text
        : `@${agent.displayName} ${text}`;
      await api.messages.send(askChannel.id, {
        body: tagged,
        clientMsgId: crypto.randomUUID(),
        threadRootId: null,
        attachmentIds: [],
      });
      setAsk('');
      await showChannel(askChannel.id);
    } catch (err) {
      showError(err);
    } finally {
      setSending(false);
    }
  }

  const mentions = unread.reduce((n, c) => n + (c.mentionCount || 0), 0);
  const needsYou = waiting.length + mentions;

  // "Needs you" counts decisions as well as mentions, and only this page shows both: the
  // decisions in their card, the mentions as green pills in Unread. So the tile takes you
  // down the page to them rather than away from it — to the decisions first, which are an
  // agent stopped until you answer. The mentions page cannot show a decision at all.
  const decisionsRef = useRef<HTMLElement>(null);
  const unreadRef = useRef<HTMLElement>(null);
  function showWhatNeedsYou() {
    const target = waiting.length > 0 ? decisionsRef.current : unreadRef.current;
    if (!target) return;
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
  }
  const firstName = currentUser?.displayName.trim().split(/\s+/)[0] ?? '';

  return (
    <main className="pane home">
      <header className="pane-header">
        <div className="min-0">
          <div className="pane-heading">
            <h1 className="pane-title">Home</h1>
          </div>
          <div className="pane-sub">{workspaceName} · what needs you, and what the agents are doing</div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => useStore.setState({ catchupScope: 'all' })}
        >
          <SparkIcon size="sm" />
          Catch me up
        </button>
      </header>

      <div className="home-body">
        {/* The board opens with where you stand, in a sentence, before any number: the
            numbers below are the detail, and a row of zeros was the first thing a quiet
            morning used to say. */}
        <section className="home-hero" aria-label="Where you stand">
          <p className="home-greeting">
            {greeting(new Date())}
            {firstName && `, ${firstName}`}
          </p>
          <p className="home-summary">{summary(waiting.length, mentions, unread.length)}</p>
        </section>

        {/* Meadow's ambient strip: the product's ✦ and a line to type in. A composer, so it
            is allowed the composer's lift and the composer's ring when focused. */}
        <form className="home-ask" onSubmit={(e) => void submitAsk(e)}>
          <span className="home-ask-mark" aria-hidden="true">
            <SparkIcon size="sm" />
          </span>
          <input
            className="home-ask-input"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder={agent ? `Ask @${agent.displayName}…` : 'No agent installed yet'}
            aria-label="Ask the workspace agent"
            disabled={!agent || sending}
          />
          <button className="btn btn-primary" type="submit" disabled={!agent || !ask.trim() || sending}>
            <SendIcon size="sm" />
            {sending ? 'Sending…' : 'Ask'}
          </button>
        </form>

        <div className="home-stats">
          <Stat
            label="Needs you"
            value={needsYou}
            tone="accent"
            icon={<MentionIcon size="md" />}
            onOpen={needsYou > 0 ? showWhatNeedsYou : undefined}
          />
          <Stat
            label="Agents running"
            value={running.length}
            tone="iris"
            live={running.length > 0}
            icon={<SparkIcon size="md" />}
          />
          <Stat
            label="Open tasks"
            value={openTasks.length}
            icon={<FileIcon size="md" />}
            onOpen={() => navigate('/tasks')}
          />
          <Stat label="Here now" value={peopleHere.length} tone="clay" icon={<MembersIcon size="md" />} />
        </div>

        <div className="home-grid">
          {/* The heading stays the section's first child, with its count a sibling rather
              than inside it: inside, the count would become part of the heading's name. */}
          <section className="home-card" ref={decisionsRef} tabIndex={-1}>
            <h2>Needs a decision</h2>
            <CardCount value={waiting.length} />
            {waiting.length === 0 && <p className="muted">Nothing waiting.</p>}
            {waiting.map((runId) => (
              <HomeRun key={runId} runId={runId} answer />
            ))}
          </section>

          <section className="home-card">
            <h2>Agents live</h2>
            <CardCount value={running.length} />
            {running.length === 0 && <p className="muted">No agent is working right now.</p>}
            {running.map((runId) => (
              <HomeRun key={runId} runId={runId} />
            ))}
          </section>

          <section className="home-card" ref={unreadRef} tabIndex={-1}>
            <h2>Unread</h2>
            <CardCount value={unread.length} />
            {unread.length === 0 && <p className="muted">You are caught up.</p>}
            {unread.slice(0, 8).map((channel) => (
              <button key={channel.id} type="button" className="home-row" onClick={() => void showChannel(channel.id)}>
                <strong>{channelTitle(channel)}</strong>
                {(channel.mentionCount ?? 0) > 0 ? (
                  <span className="home-pill" data-tone="accent">
                    {channel.mentionCount} mention{channel.mentionCount === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="home-pill" data-tone="clay">
                    new
                  </span>
                )}
              </button>
            ))}
          </section>

          <section className="home-card">
            <h2>Your tasks</h2>
            <CardCount value={openTasks.length} />
            {tasks === null && <ListSkeleton rows={2} avatar="none" />}
            {tasks && openTasks.length === 0 && <p className="muted">Nothing queued for you.</p>}
            {openTasks.slice(0, 8).map((task) => (
              <button
                key={task.id}
                type="button"
                className="home-row"
                onClick={() => void (task.threadRootId ? showThread(task.channelId, task.threadRootId) : showChannel(task.channelId))}
              >
                <strong>{task.title}</strong>
                <span className="home-pill">{task.status.replace('_', ' ')}</span>
              </button>
            ))}
          </section>
        </div>

        {(peopleHere.length > 0 || doneToday.length > 0) && (
          <section className="home-card home-pulse">
            <h2>Pulse</h2>
            {peopleHere.length > 0 && (
              <p>
                Here now:{' '}
                {peopleHere.map((p) => p.displayName).join(', ')}
              </p>
            )}
            {doneToday.slice(0, 5).map((runId) => (
              <DoneLine key={runId} runId={runId} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

const oldestFirst = (a: AgentRunView, b: AgentRunView) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const newestFinished = (a: AgentRunView, b: AgentRunView) =>
  (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '');

/**
 * One run on the board: the way to its conversation, and its card. It subscribes to its
 * own run, so a live snapshot redraws this row and nothing else on Home.
 */
function HomeRun({ runId, answer = false }: { runId: string; answer?: boolean }) {
  const run = useRun(runId);
  const channel = useStore((s) => (run ? s.channels[run.channelId] : undefined));
  const channelTitle = useStore((s) => s.channelTitle);
  if (!run) return null;
  return (
    <div className="home-run">
      {/* The question itself is a message in the channel, with the buttons or the box to
          answer it. This row is the way there, and says so — a card that only reported
          the wait left people looking for a control that lives one screen away. */}
      <button
        type="button"
        className="home-row"
        onClick={() =>
          void (run.threadRootId
            ? showThread(run.channelId, run.threadRootId)
            : showChannel(run.channelId))
        }
      >
        <strong>{run.agentName}</strong>
        <span className="muted">{channel ? channelTitle(channel) : 'channel'}</span>
        {answer && <span className="home-run-go">Answer →</span>}
      </button>
      <AgentRunCard run={run} />
    </div>
  );
}

function DoneLine({ runId }: { runId: string }) {
  const run = useRun(runId);
  if (!run) return null;
  return (
    <p className="muted">
      {run.agentName} finished {formatRelative(run.finishedAt ?? run.startedAt)}
    </p>
  );
}

/** The hour's greeting. Past midnight is still the evening: nobody at work at 2am wants
 *  to be told it is morning. */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Where you stand, in one sentence, from the same counts the tiles show. */
function summary(decisions: number, mentions: number, conversations: number): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    decisions > 0 && plural(decisions, 'decision waiting on you', 'decisions waiting on you'),
    mentions > 0 && plural(mentions, 'mention', 'mentions'),
    conversations > 0 &&
      plural(conversations, 'conversation with something new', 'conversations with something new'),
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return 'You are all caught up.';
  const last = parts.pop() as string;
  return `${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}.`;
}

/**
 * One number on the board, with what it counts and where to go about it. A button when
 * there is somewhere to go — the mentions, the task list — and a plain tile when the
 * place is already on this screen.
 */
function Stat({
  label,
  value,
  icon,
  tone,
  live,
  onOpen,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'accent' | 'iris' | 'clay';
  live?: boolean;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="home-stat-head">
        <span className="home-stat-label">{label}</span>
        <span className="home-stat-icon" aria-hidden="true">
          {icon}
        </span>
      </span>
      <span
        className="home-stat-value"
        data-live={live ? 'true' : undefined}
        data-zero={value === 0 ? 'true' : undefined}
      >
        {value}
      </span>
    </>
  );
  return onOpen ? (
    <button type="button" className="home-stat" data-tone={tone} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="home-stat" data-tone={tone}>
      {body}
    </div>
  );
}

/** How many a card holds, beside its heading. Nothing at all for none: the card's own
 *  empty line already says so. */
function CardCount({ value }: { value: number }) {
  if (value === 0) return null;
  return <span className="home-card-count">{value}</span>;
}
