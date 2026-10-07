/** What agents have done here, or what one agent has done anywhere you can see.
 *
 * The conversation's own list is its live cards and the last hour; this is the history
 * behind it, a page at a time, newest first. Each run is the card it left — what it did,
 * what it was shown, how it ended — so the question a surprising answer raises has
 * somewhere to be answered. An agent's history leaves out the rooms you are not in;
 * the server decides that, inside the query, as it does for Home.
 */

import { useEffect, useState } from 'react';
import type { AgentRunView } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { AgentRunCard } from './AgentRunCard.tsx';
import { errorMessage } from './threadTools.ts';
import { formatRelative } from './messageFormatting.ts';

export type RunHistoryScope = { channelId: string } | { agentUserId: string };

const PAGE = 20;

export function RunHistoryDialog({
  scope,
  title,
  onClose,
}: {
  scope: RunHistoryScope;
  title: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scopeKey = 'channelId' in scope ? `c:${scope.channelId}` : `a:${scope.agentUserId}`;

  useEffect(() => {
    let current = true;
    api.agentRuns
      .history({ ...scope, limit: PAGE })
      .then((page) => {
        if (!current) return;
        setRuns(page.runs);
        setNext(page.nextBefore);
      })
      .catch((err: unknown) => {
        if (current) setError(errorMessage(err, 'Could not load the runs.'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
    // The scope's key is the honest dependency: the object is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  async function older() {
    if (!next) return;
    setLoading(true);
    try {
      const page = await api.agentRuns.history({ ...scope, before: next, limit: PAGE });
      setRuns((held) => [...held, ...page.runs]);
      setNext(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err, 'Could not load older runs.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog label={title} onClose={onClose}>
      <div className="dialog run-history">
        <h2 className="dialog-title">{title}</h2>
        {error && <p className="error-text">{error}</p>}
        {!error && !loading && runs.length === 0 && (
          <p className="muted">No agent has been asked anything here yet.</p>
        )}
        <ol className="run-history-list">
          {runs.map((run) => (
            <li key={run.id}>
              <RunHistoryRow run={run} showPlace={'agentUserId' in scope} />
            </li>
          ))}
        </ol>
        <div className="dialog-actions">
          {next && (
            <button className="btn btn-ghost" disabled={loading} onClick={() => void older()}>
              {loading ? 'Loading…' : 'Older runs'}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function RunHistoryRow({ run, showPlace }: { run: AgentRunView; showPlace: boolean }) {
  const channel = useStore((s) => s.channels[run.channelId]);
  const channelTitle = useStore((s) => s.channelTitle);
  return (
    <div className="run-history-row">
      <div className="run-history-when">
        {formatRelative(run.startedAt)}
        {showPlace && (
          <span className="muted">{` · ${channel ? channelTitle(channel) : 'a conversation'}`}</span>
        )}
      </div>
      <AgentRunCard run={run} compact />
    </div>
  );
}
