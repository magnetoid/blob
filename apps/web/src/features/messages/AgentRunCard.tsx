/** The live view of what an agent is doing, under the message that asked it.
 *
 * Renders the folded card the worker broadcasts — plan steps, tool calls, the latest
 * activity line, a collapsed reasoning tail — with a Stop button while the run is
 * going. Slack ships exactly this shape (plan blocks, task states, a native stop);
 * the point is that "the agent is working" stops being two minutes of empty room.
 */

import { useState } from 'react';
import type { AgentRunView } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';

export function AgentRunCard({ run }: { run: AgentRunView }) {
  const [stopping, setStopping] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const running = run.status === 'running';
  const card = run.card;
  const doneSteps = card?.steps.filter((s) => s.status === 'done').length ?? 0;

  return (
    <div className="agent-run-card" data-status={run.status}>
      <div className="agent-run-head">
        <span className={`agent-run-dot ${running ? 'agent-run-dot-live' : ''}`} aria-hidden />
        <span className="agent-run-name">{run.agentName}</span>
        <span className="agent-run-state">
          {running
            ? card?.activity ??
              (card && card.steps.length > 0
                ? `${doneSteps} of ${card.steps.length}`
                : 'working…')
            : statusLabel(run)}
        </span>
        {running && (
          <button
            type="button"
            className="btn btn-ghost agent-run-stop"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await api.agentRuns.cancel(run.id);
              } catch (err) {
                showError(err);
                setStopping(false);
              }
            }}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

      {card && card.steps.length > 0 && (
        <ol className="agent-run-steps">
          {card.steps.map((step) => (
            <li key={step.name} data-status={step.status}>
              <span className="agent-run-step-mark" aria-hidden>
                {step.status === 'done' ? '✓' : '•'}
              </span>
              {step.name}
            </li>
          ))}
        </ol>
      )}

      {card && card.tools.length > 0 && (
        <div className="agent-run-tools">
          {card.tools.map((tool, index) => (
            <details key={index} className="agent-run-tool" data-status={tool.status}>
              <summary>
                <code>{tool.name}</code>
                <span className="agent-run-tool-state">
                  {tool.status === 'done' ? 'done' : 'running…'}
                </span>
              </summary>
              {tool.args && <pre className="agent-run-io">{tool.args}</pre>}
              {tool.result && <pre className="agent-run-io">{tool.result}</pre>}
            </details>
          ))}
        </div>
      )}

      {card?.reasoning && (
        <div className="agent-run-reasoning">
          <button
            type="button"
            className="btn btn-ghost agent-run-reasoning-toggle"
            aria-expanded={reasoningOpen}
            onClick={() => setReasoningOpen((v) => !v)}
          >
            {reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
          </button>
          {reasoningOpen && <pre className="agent-run-io">{card.reasoning}</pre>}
        </div>
      )}
    </div>
  );
}

function statusLabel(run: AgentRunView): string {
  switch (run.status) {
    case 'succeeded':
      return run.postCount > 0 ? durationLabel(run) : `answered silently · ${durationLabel(run)}`;
    case 'failed':
      return run.error ? `failed — ${run.error}` : 'failed';
    case 'cancelled':
      return 'stopped';
    case 'refused':
      return run.error ?? 'refused — over its daily budget';
    case 'interrupted':
      return 'needs a decision';
    default:
      return run.status;
  }
}

function durationLabel(run: AgentRunView): string {
  if (!run.finishedAt) return '';
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ms < 1000 ? '<1s' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}
