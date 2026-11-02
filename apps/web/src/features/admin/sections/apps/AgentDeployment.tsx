/** Whether a hosted agent is actually running, and what it said if it is not.
 *
 * Only shown for agents Blob deployed. An app registered with its own URL runs wherever
 * its author put it, and this has nothing true to say about it.
 *
 * Status is fetched when the row is opened rather than polled: a list of agents polling
 * a runner is a lot of requests to answer a question nobody is looking at.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { api, ApiError, type AgentDeployment as Deployment } from '../../../../lib/api.ts';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import { AgentConfig } from './AgentConfig.tsx';
import { AgentTerminal } from '../../../agentic/AgentTerminal.tsx';

interface Props {
  pluginId: string;
  agentName: string;
  repo: string | null;
  // Not `ref`. React reserves that name and extracts it from props, so a component
  // declaring one is handed undefined and silently loses the branch it was showing.
  gitRef: string | null;
  onError: (message: string | null) => void;
}

export function AgentDeployment({ pluginId, agentName, repo, gitRef, onError }: Props) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One at a time. Configuration and a terminal are two ways of doing the same job, and
  // both open at once is a tall row where neither is the thing being read.
  const [panel, setPanel] = useState<'config' | 'terminal' | null>(null);
  const ids = useId();
  const panelIds = { config: `${ids}-config`, terminal: `${ids}-terminal`, logs: `${ids}-logs` };

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
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/50 p-3">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Badge variant={deployment?.status === 'running' ? 'secondary' : 'outline'}>
          {deployment?.status ?? 'checking…'}
        </Badge>
        {repo && (
          <a
            href={repo}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate font-mono text-xs underline underline-offset-4"
          >
            {repo.replace('https://github.com/', '')}
            {gitRef && gitRef !== 'main' ? `@${gitRef}` : ''}
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Two halves of setting an agent up, side by side because that is what they
            are: the values it declares it needs, and the session for everything that is
            not a value. Neither replaces the other — a device-code login is not a field,
            and an API key is not worth opening a shell for. The names stay put,
            `aria-expanded` says which is open, and `aria-controls` points at its panel only
            while the panel is there. */}
        <Button
          variant="outline"
          disabled={busy}
          aria-expanded={panel === 'config'}
          aria-controls={panel === 'config' ? panelIds.config : undefined}
          onClick={() => setPanel((p) => (p === 'config' ? null : 'config'))}
        >
          Config
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          aria-expanded={panel === 'terminal'}
          aria-controls={panel === 'terminal' ? panelIds.terminal : undefined}
          onClick={() => setPanel((p) => (p === 'terminal' ? null : 'terminal'))}
        >
          Terminal
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          aria-expanded={logs !== null}
          aria-controls={logs !== null ? panelIds.logs : undefined}
          onClick={() => void showLogs()}
        >
          Logs
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => api.admin.redeploy(pluginId), 'Redeploy failed.')}
        >
          Redeploy
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => api.admin.stopAgent(pluginId), 'Could not stop it.')}
        >
          Stop
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {panel === 'config' && (
        <div id={panelIds.config}>
          <AgentConfig pluginId={pluginId} onError={onError} />
        </div>
      )}

      {panel === 'terminal' && (
        // The terminal is the conversation's own (`features/agentic/`), drawn by its own
        // stylesheet, and it is also where xterm.js is mounted — so it stays an island.
        <div id={panelIds.terminal} data-legacy>
          <AgentTerminal
            pluginId={pluginId}
            agentName={agentName}
            onClose={() => setPanel(null)}
          />
        </div>
      )}

      {logs !== null && (
        <pre id={panelIds.logs} className="m-0 max-h-75 overflow-auto rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {logs}
        </pre>
      )}
    </div>
  );
}
