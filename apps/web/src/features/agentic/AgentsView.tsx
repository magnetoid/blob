/** Every agent you can ask, and what each one is doing (M1 · A4).
 *
 * The sidebar's Agents section lists them as conversations; this is the page that says
 * what they are. Each row is one agent you may set going — the workspace's, your own, or
 * one lent to you; somebody else's own agent is not listed, the rule that keeps a mention
 * of it silent — with what it says it does, and where it stands: working in a channel,
 * waiting for your answer, or when it last ran.
 *
 * Where it stands is read from runs, never from presence: Blob sends no presence for apps
 * (the privacy rule), and a run is the honest answer to "what is it doing". The runs are
 * the ones the store already keeps fresh from the socket — folded in on arrival the way
 * Home folds them, so a list fetched before a run finished cannot put it back to running.
 * The page reads them through `useRunIds`, the selector Home's board uses, so a running
 * card's four snapshots a second redraw nothing here; only a run starting, stopping to
 * ask, being answered or ending does.
 */

import { useState } from 'react';
import type { AgentRunView } from '@blob/shared';
import { api, type WorkspaceAgent } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useRunIds } from '../../lib/useRuns.ts';
import { navigate } from '../../lib/router.ts';
import { showChannel, showDirectMessage } from '../../lib/navigation.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { DialogPresence } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ListSkeleton } from '../../components/ListSkeleton.tsx';
import { SparkIcon } from '../../components/Icon.tsx';
import { RunHistoryDialog } from '../messages/RunHistoryDialog.tsx';
import { formatRelative } from '../messages/messageFormatting.ts';
import { formatMoment } from '../../lib/format.ts';
import { standingOf, type Standing } from './standing.ts';

/** Newest first, the order every standing reads its runs in. */
const newest = (a: AgentRunView, b: AgentRunView) => b.startedAt.localeCompare(a.startedAt);

/**
 * The runs the standings are read from, without scanning the run map once more.
 *
 * Three id lists over the shared selector (`useRunIds`) — running, waiting on you, and
 * ended. An id list changes only when a run joins or leaves it, which is exactly when a
 * standing can change: a run starting, stopping to ask, being answered or finishing. A
 * running card's snapshots change none of them, so they redraw nothing here. What is read
 * from each run — its agent, room and times — is fixed by the time it is in its list.
 */
function useStandingRuns(me: string | null): AgentRunView[] {
  const working = useRunIds((r) => r.status === 'running' || r.status === 'waiting', newest);
  const waiting = useRunIds(
    (r) => r.status === 'interrupted' && !r.answeredAt && me !== null && r.initiatedByUserId === me,
    newest,
  );
  const ended = useRunIds((r) => r.status !== 'running' && r.status !== 'waiting', newest);
  const byId = useStore.getState().agentRuns;
  const ids = new Set([...working, ...waiting, ...ended]);
  return [...ids].map((id) => byId[id]).filter((run): run is AgentRunView => run !== undefined);
}

export function AgentsView() {
  const me = useStore((s) => s.currentUser);
  const [history, setHistory] = useState<WorkspaceAgent | null>(null);

  const { data: agents, error } = useFetch(
    async (): Promise<WorkspaceAgent[]> => (await api.agents.list()).agents,
    [me?.id],
  );
  // The runs the rows read their standing from, folded into the store the socket keeps
  // fresh. Nothing renders this value; a failure leaves the rows saying what they knew.
  useFetch(
    async () => {
      const { runs } = await api.agentRuns.mine();
      useStore.getState().foldRuns(runs);
      return runs;
    },
    [me?.id],
  );
  const runs = useStandingRuns(me?.id ?? null);
  const isAdmin = me?.role === 'admin' || me?.role === 'owner';

  return (
    <main className="pane">
      <header className="pane-header">
        <div className="min-0">
          <div className="pane-heading">
            <h1 className="pane-title">Agents</h1>
          </div>
          <div className="pane-sub">Who you can ask, what each one does, and what it is doing now</div>
        </div>
      </header>

      <div className="search-results">
        {error && <p className="error-text">The agents could not be loaded.</p>}
        {!error && agents === null && <ListSkeleton rows={3} />}

        {agents?.length === 0 && (
          <EmptyState mark={<SparkIcon size="xl" />} title="No agents you can ask yet">
            An admin adds the workspace&apos;s agents under Agents &amp; apps, and you can
            connect one of your own in Settings → My agents.
          </EmptyState>
        )}

        {agents && agents.length > 0 && (
          <ul className="agent-list" aria-label="Agents">
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                standing={standingOf(runs, agent.id, me?.id ?? null)}
                isAdmin={isAdmin}
                onRuns={() => setHistory(agent)}
              />
            ))}
          </ul>
        )}
      </div>

      <DialogPresence when={history}>
        {(agent) => (
          <RunHistoryDialog
            scope={{ agentUserId: agent.botUserId }}
            title={`What ${agent.name} has done`}
            onClose={() => setHistory(null)}
          />
        )}
      </DialogPresence>
    </main>
  );
}

function AgentRow({
  agent,
  standing,
  isAdmin,
  onRuns,
}: {
  agent: WorkspaceAgent;
  standing: Standing;
  isAdmin: boolean;
  onRuns: () => void;
}) {
  const user = useStore((s) => s.users[agent.botUserId]);
  const channel = useStore((s) =>
    standing.kind === 'quiet' ? undefined : s.channels[standing.channelId],
  );
  const channelTitle = useStore((s) => s.channelTitle);

  const whose = agent.mine ? 'Yours' : agent.lent ? 'Lent to you' : 'The workspace’s';
  // Yours is configured in your settings; the workspace's in the console, by an admin.
  const settings = agent.mine
    ? '/settings/my-agents'
    : !agent.lent && isAdmin
      ? `/admin/apps/${agent.id}`
      : null;
  const where = channel ? (channel.name ? `#${channel.name}` : channelTitle(channel)) : 'a conversation';

  return (
    <li className="agent-row">
      <Avatar user={user ?? { displayName: agent.name, avatarUrl: null, kind: 'bot' }} size="lg" />
      <div className="grow min-0">
        <div className="search-result-head">
          <span className="search-result-author">{agent.name}</span>
          <span className="search-result-meta">{whose}</span>
        </div>
        <p className="agent-row-what">{agent.description ?? 'It has not said what it does.'}</p>
        <StandingLine standing={standing} where={where} />
      </div>
      <div className="agent-row-actions">
        <button className="btn btn-agent" onClick={() => void showDirectMessage(agent.botUserId)}>
          Message
        </button>
        <button className="btn btn-ghost" onClick={onRuns}>
          Runs
        </button>
        {settings && (
          <button className="btn btn-ghost" onClick={() => navigate(settings)}>
            Settings
          </button>
        )}
      </div>
    </li>
  );
}

function StandingLine({ standing, where }: { standing: Standing; where: string }) {
  if (standing.kind === 'quiet') {
    return <div className="agent-row-standing">Nothing in the last day</div>;
  }
  const go = () => void showChannel(standing.channelId);
  if (standing.kind === 'working') {
    return (
      <div className="agent-row-standing" data-state="working">
        <span className="agent-live-dot" aria-hidden="true" />
        Working in{' '}
        <button className="agent-row-where" onClick={go}>
          {where}
        </button>
      </div>
    );
  }
  if (standing.kind === 'waiting') {
    return (
      <div className="agent-row-standing" data-state="waiting">
        Waiting for your answer in{' '}
        <button className="agent-row-where" onClick={go}>
          {where}
        </button>
      </div>
    );
  }
  if (standing.kind === 'returning') {
    return (
      <div className="agent-row-standing" data-state="returning">
        Coming back {formatMoment(standing.at)} in{' '}
        <button className="agent-row-where" onClick={go}>
          {where}
        </button>
      </div>
    );
  }
  return (
    <div className="agent-row-standing">
      Last ran {formatRelative(standing.at)} in{' '}
      <button className="agent-row-where" onClick={go}>
        {where}
      </button>
    </div>
  );
}
