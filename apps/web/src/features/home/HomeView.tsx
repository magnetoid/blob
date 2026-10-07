/** The first screen: what needs you, what agents are doing, ask one.

 * Conversations stay in channels. This is the Slack home that Blob never had —
 * a live board, not a settings form, so a team that wants to move fast does not
 * start by hunting #general.
 */

import { useMemo, useState, type FormEvent } from 'react';
import type { AgentRunView, AgentTask } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useRun, useRunIds } from '../../lib/useRuns.ts';
import { agentIsAvailable } from '../../lib/conversations.ts';
import { showChannel, showThread } from '../../lib/navigation.ts';
import { showError } from '../../lib/toasts.ts';
import { SendIcon } from '../../components/Icon.tsx';
import { AgentRunCard } from '../messages/AgentRunCard.tsx';
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
          Catch me up
        </button>
      </header>

      <div className="home-body">
        <form className="home-ask" onSubmit={(e) => void submitAsk(e)}>
          <label className="field" style={{ flex: 1, margin: 0 }}>
            <input
              className="input"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder={agent ? `Ask @${agent.displayName}…` : 'No agent installed yet'}
              aria-label="Ask the workspace agent"
              disabled={!agent || sending}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!agent || !ask.trim() || sending}>
            <SendIcon size="sm" />
            {sending ? 'Sending…' : 'Ask'}
          </button>
        </form>

        <div className="home-stats">
          <Stat label="Needs you" value={String(waiting.length + unread.reduce((n, c) => n + (c.mentionCount || 0), 0))} />
          <Stat label="Agents running" value={String(running.length)} live={running.length > 0} />
          <Stat label="Open tasks" value={String(openTasks.length)} />
          <Stat label="Here now" value={String(peopleHere.length)} />
        </div>

        <div className="home-grid">
          <section className="home-card">
            <h2>Needs a decision</h2>
            {waiting.length === 0 && <p className="muted">Nothing waiting.</p>}
            {waiting.map((runId) => (
              <HomeRun key={runId} runId={runId} answer />
            ))}
          </section>

          <section className="home-card">
            <h2>Agents live</h2>
            {running.length === 0 && <p className="muted">No agent is working right now.</p>}
            {running.map((runId) => (
              <HomeRun key={runId} runId={runId} />
            ))}
          </section>

          <section className="home-card">
            <h2>Unread</h2>
            {unread.length === 0 && <p className="muted">You are caught up.</p>}
            {unread.slice(0, 8).map((channel) => (
              <button key={channel.id} type="button" className="home-row" onClick={() => void showChannel(channel.id)}>
                <strong>{channelTitle(channel)}</strong>
                <span className="muted">
                  {(channel.mentionCount ?? 0) > 0 ? `${channel.mentionCount} mention${channel.mentionCount === 1 ? '' : 's'}` : 'new messages'}
                </span>
              </button>
            ))}
          </section>

          <section className="home-card">
            <h2>Your tasks</h2>
            {tasks === null && <p className="muted">Loading…</p>}
            {tasks && openTasks.length === 0 && <p className="muted">Nothing queued for you.</p>}
            {openTasks.slice(0, 8).map((task) => (
              <button
                key={task.id}
                type="button"
                className="home-row"
                onClick={() => void (task.threadRootId ? showThread(task.channelId, task.threadRootId) : showChannel(task.channelId))}
              >
                <strong>{task.title}</strong>
                <span className="muted">{task.status.replace('_', ' ')}</span>
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

function Stat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" data-live={live ? 'true' : undefined}>
        {value}
      </div>
    </div>
  );
}
