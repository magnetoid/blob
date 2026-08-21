/** Whether a hosted agent is actually running, and what it said if it is not.
 *
 * Only shown for agents Blob deployed. An app registered with its own URL runs wherever
 * its author put it, and this has nothing true to say about it.
 *
 * Status is fetched when the row is opened rather than polled: a list of agents polling
 * a runner is a lot of requests to answer a question nobody is looking at.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AgentDeployment as Deployment } from '../../lib/api.ts';

interface Props {
  pluginId: string;
  repo: string | null;
  // Not `ref`. React reserves that name and extracts it from props, so a component
  // declaring one is handed undefined and silently loses the branch it was showing.
  gitRef: string | null;
  onError: (message: string | null) => void;
}

export function AgentDeployment({ pluginId, repo, gitRef, onError }: Props) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      onError(err instanceof ApiError ? err.message : fallback);
    },
    [onError],
  );

  const refresh = useCallback(async () => {
    try {
      setDeployment(await api.admin.deployment(pluginId));
    } catch (err) {
      fail(err, 'Could not reach the runner.');
    }
  }, [pluginId, fail]);

  // Fetched inline rather than through refresh(), so a row closed before the runner
  // answers does not set state on a component that is gone.
  useEffect(() => {
    let current = true;
    api.admin
      .deployment(pluginId)
      .then((next) => {
        if (current) setDeployment(next);
      })
      .catch((err: unknown) => {
        if (current) fail(err, 'Could not reach the runner.');
      });
    return () => {
      current = false;
    };
  }, [pluginId, fail]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      fail(err, fallback);
    } finally {
      setBusy(false);
    }
  }

  async function showLogs() {
    if (logs !== null) {
      setLogs(null);
      return;
    }
    setBusy(true);
    try {
      setLogs((await api.admin.deploymentLogs(pluginId)).logs || 'Nothing logged yet.');
    } catch (err) {
      fail(err, 'Could not read the logs.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent-deployment-panel">
      <div className="agent-deployment">
        <span className="role-pill" data-muted={deployment?.status !== 'running'}>
          {deployment?.status ?? 'checking…'}
        </span>
        {repo && (
          <a href={repo} target="_blank" rel="noreferrer">
            {repo.replace('https://github.com/', '')}
            {gitRef && gitRef !== 'main' ? `@${gitRef}` : ''}
          </a>
        )}
      </div>

      <div className="chip-row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy} onClick={() => void showLogs()}>
          {logs !== null ? 'Hide logs' : 'Logs'}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void run(() => api.admin.redeploy(pluginId), 'Redeploy failed.')}
        >
          Redeploy
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void run(() => api.admin.stopAgent(pluginId), 'Could not stop it.')}
        >
          Stop
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {logs !== null && <pre className="agent-logs">{logs}</pre>}
    </div>
  );
}
