/** The live view of what an agent is doing, under the message that asked it.
 *
 * Renders the folded card the worker broadcasts — plan steps, tool calls, the latest
 * activity line, a collapsed reasoning tail — with a Stop button while the run is
 * going. Slack ships exactly this shape (plan blocks, task states, a native stop);
 * the point is that "the agent is working" stops being two minutes of empty room.
 *
 * In a conversation, a run that ended well becomes a line instead: once the answer is
 * there, the answer is what to read, and a framed card after every one of them was the
 * loudest thing on the screen. Everything that still wants a person — a run going, one
 * that failed or was refused, one waiting for an answer — keeps the card.
 */

import { useState } from 'react';
import type { AgentRunCard as RunCard, AgentRunView } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { ChevronDownIcon } from '../../components/Icon.tsx';

interface Props {
  run: AgentRunView;
  /**
   * Draw a run that finished or was stopped as a quiet line rather than a card.
   *
   * The conversation's list asks for it; Home and the work panel do not, because there
   * the runs are the content rather than a footnote to an answer above them.
   */
  compact?: boolean;
  /**
   * Whether the row above is the list's tab stop. The line's one control follows it,
   * like the row's own actions, or every finished run would cost a press of Tab.
   */
  isTabStop?: boolean;
}

export function AgentRunCard({ run, compact = false, isTabStop = true }: Props) {
  return compact && (run.status === 'succeeded' || run.status === 'cancelled') ? (
    <RunLine run={run} isTabStop={isTabStop} />
  ) : (
    <FullCard run={run} />
  );
}

function FullCard({ run }: { run: AgentRunView }) {
  const [stopping, setStopping] = useState(false);

  const running = run.status === 'running';
  const card = run.card;
  const doneSteps = card?.steps.filter((s) => s.status === 'done').length ?? 0;

  return (
    <div className="agent-run-card" data-status={run.status}>
      <div className="agent-run-head">
        <span className={`agent-run-dot ${running ? 'agent-run-dot-live' : ''}`} aria-hidden />
        <span className="agent-run-name">{run.agentName}</span>
        {run.askedBy && (
          // Whose question this is. A card under an agent's message reads as that
          // agent talking to itself unless it says which agent asked — and how far
          // from the person the chain has travelled.
          <span className="agent-run-lineage">{lineage(run)}</span>
        )}
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
            className="btn btn-agent agent-run-stop"
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

      {/* A bar, not a percentage: the model decides how many steps there are while it
          is taking them, so there is no fraction to show. Presentational and hidden
          from the reader — the head above already says "running" in words. */}
      {running && <div className="agent-run-progress" aria-hidden />}

      {card && <RunWork card={card} />}
    </div>
  );
}

/**
 * A finished run as one line of meta under the message that asked: who, and how it
 * ended. What it did along the way is still there, behind a single "details", and
 * unframed when opened — the line never grows back into the card it replaced.
 */
function RunLine({ run, isTabStop }: { run: AgentRunView; isTabStop: boolean }) {
  const [open, setOpen] = useState(false);
  const card = run.card;
  const hasWork = Boolean(
    card && (card.steps.length > 0 || card.tools.length > 0 || card.reasoning),
  );
  const said = [run.askedBy ? lineage(run) : '', statusLabel(run)].filter(Boolean);

  return (
    // Off, inside a list that announces what is added: this line arrives in place of a
    // card whose status settled without a word, and should arrive the same way.
    <div className="agent-run-line" data-status={run.status} aria-live="off">
      <span className="agent-run-line-text">
        <span className="agent-run-line-name">{run.agentName}</span>
        {said.map((part) => ` · ${part}`).join('')}
      </span>
      {hasWork && (
        <button
          type="button"
          className="agent-run-line-toggle"
          aria-expanded={open}
          // A name that stands alone, for anybody who meets it in a list of buttons;
          // it starts with the word on screen, so saying "details" still finds it.
          aria-label={`Details of ${run.agentName}'s run`}
          tabIndex={isTabStop ? 0 : -1}
          onClick={() => setOpen((value) => !value)}
        >
          details
          <ChevronDownIcon size="sm" />
        </button>
      )}
      {open && card && (
        <div className="agent-run-line-work">
          <RunWork card={card} />
        </div>
      )}
    </div>
  );
}

/** What a run did: its plan, its tool calls and, behind a toggle, its reasoning. */
function RunWork({ card }: { card: RunCard }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);

  return (
    <>
      {card.steps.length > 0 && (
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

      {card.tools.length > 0 && (
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

      {card.reasoning && (
        <div className="agent-run-reasoning">
          <button
            type="button"
            className="btn btn-agent agent-run-reasoning-toggle"
            aria-expanded={reasoningOpen}
            onClick={() => setReasoningOpen((v) => !v)}
          >
            {reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
          </button>
          {reasoningOpen && <pre className="agent-run-io">{card.reasoning}</pre>}
        </div>
      )}
    </>
  );
}

function lineage(run: AgentRunView): string {
  return `asked by ${run.askedBy}${run.depth > 1 ? ` · hop ${run.depth}` : ''}`;
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
      // Not "see below": this card also renders on Home, in the one section people
      // are meant to check for exactly this, where there is nothing below it — the
      // question is in a channel and the row above the card is the way there.
      return run.answeredAt ? 'answered' : 'waiting for your answer';
    case 'expired':
      return 'nobody answered in time';
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
