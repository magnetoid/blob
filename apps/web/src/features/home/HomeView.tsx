/** The first screen: what needs you, what agents are doing, ask one.

 * Conversations stay in channels. This is the Slack home that Blob never had —
 * a live board, not a settings form, so a team that wants to move fast does not
 * start by hunting #general.
 */

import { useMemo, useState, type FormEvent } from 'react';
import type { AgentTask } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
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
  const agentRuns = useStore((s) => s.agentRuns);
  const channelTitle = useStore((s) => s.channelTitle);

  function placeName(channelId: string): string {
    const channel = channels[channelId];
    return channel ? channelTitle(channel) : 'channel';
  }

  const [ask, setAsk] = useState('');
  const [sending, setSending] = useState(false);
  const { data: tasks } = useFetch(
    async (): Promise<AgentTask[]> =>
      (await api.agentic.listTasks(currentUser ? { assignee: currentUser.id } : {})).tasks,
    [currentUser?.id],
  );
  // Your runs, folded into the store the cards below read from. Nothing renders the
  // value itself; the fetch is for the side effect, and a failure changes nothing.
  useFetch(
    async () => {
      const { runs } = await api.agentRuns.mine();
      useStore.setState((s) => ({
        agentRuns: {
          ...s.agentRuns,
          ...Object.fromEntries(runs.map((run) => [run.id, run])),
        },
      }));
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

  const runs = useMemo(() => Object.values(agentRuns), [agentRuns]);
  const running = runs.filter((r) => r.status === 'running');
  const waiting = runs.filter((r) => r.status === 'interrupted' && !r.answeredAt);
  const doneToday = runs.filter((r) => r.status === 'succeeded' && r.finishedAt);
  const openTasks = (tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');

  const peopleHere = useMemo(
    () =>
      Object.values(users).filter(
        (u) => !u.deactivated && u.kind === 'human' && u.id !== currentUser?.id && presence[u.id] === 'active',
      ),
    [users, presence, currentUser],
  );

  const blob = useMemo(
    () =>
      Object.values(users).find((u) => u.kind === 'bot' && u.displayName === 'Blob') ??
      Object.values(users).find((u) => u.kind === 'bot' && !u.deactivated),
    [users],
  );

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
    if (!blob || !askChannel) {
      showError(new Error('No workspace agent is installed yet.'));
      return;
    }
    setSending(true);
    try {
      const tagged = new RegExp(`@${blob.displayName}\\b`, 'i').test(text)
        ? text
        : `@${blob.displayName} ${text}`;
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
              placeholder={blob ? `Ask @${blob.displayName}…` : 'No agent installed yet'}
              aria-label="Ask the workspace agent"
              disabled={!blob || sending}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!blob || !ask.trim() || sending}>
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
            {waiting.map((run) => (
              <div key={run.id} className="home-run">
                {/* The question itself is a message in the channel, with the buttons
                    or the box to answer it. This row is the way there, and says so —
                    a card that only reported the wait left people looking for a
                    control that lives one screen away. */}
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
                  <span className="muted">{placeName(run.channelId)}</span>
                  <span className="home-run-go">Answer →</span>
                </button>
                <AgentRunCard run={run} />
              </div>
            ))}
          </section>

          <section className="home-card">
            <h2>Agents live</h2>
            {running.length === 0 && <p className="muted">No agent is working right now.</p>}
            {running.map((run) => (
              <div key={run.id} className="home-run">
                <button
                  type="button"
                  className="home-row"
                  onClick={() => void (run.threadRootId ? showThread(run.channelId, run.threadRootId) : showChannel(run.channelId))}
                >
                  <strong>{run.agentName}</strong>
                  <span className="muted">{placeName(run.channelId)}</span>
                </button>
                <AgentRunCard run={run} />
              </div>
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
            {doneToday.slice(0, 5).map((run) => (
              <p key={run.id} className="muted">
                {run.agentName} finished {formatRelative(run.finishedAt ?? run.startedAt)}
              </p>
            ))}
          </section>
        )}
      </div>
    </main>
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
