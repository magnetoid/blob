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

import { memo, useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type {
  AgentRunCard as RunCard,
  AgentRunDecision,
  AgentRunSeen,
  AgentRunView,
} from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { formatTokens } from '../../lib/format.ts';
import { useStore } from '../../lib/store.ts';
import { useRun } from '../../lib/useRuns.ts';
import { showError } from '../../lib/toasts.ts';
import { useMinute } from '../../lib/useMinute.ts';
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

/**
 * Memoised: a running card's snapshots replace its run object four times a second, and
 * a list of cards should redraw the one whose run moved, not all of them.
 */
export const AgentRunCard = memo(function AgentRunCard({
  run,
  compact = false,
  isTabStop = true,
}: Props) {
  return compact && (run.status === 'succeeded' || run.status === 'cancelled') ? (
    <RunLine run={run} isTabStop={isTabStop} />
  ) : (
    <FullCard run={run} />
  );
});

/**
 * A card that subscribes to its own run — for a list that holds only which runs hang
 * under which message (`useRunIdsByMessage`), so a snapshot redraws this card and not
 * the conversation around it.
 */
export const AgentRunCardById = memo(function AgentRunCardById({
  runId,
  compact = false,
  isTabStop = true,
}: Omit<Props, 'run'> & { runId: string }) {
  const run = useRun(runId);
  return run ? <AgentRunCard run={run} compact={compact} isTabStop={isTabStop} /> : null;
});

function FullCard({ run }: { run: AgentRunView }) {
  const [stopping, setStopping] = useState(false);
  const yours = useStore((s) => s.currentUser?.id === run.initiatedByUserId);

  const running = run.status === 'running';
  const card = run.card;
  const doneSteps = card?.steps.filter((s) => s.status === 'done').length ?? 0;
  // Asking: stopped on a question nobody has answered. Waiting: asking, with a deadline.
  const asking = run.status === 'interrupted' && !run.answeredAt;
  const waiting = asking && run.expiresAt !== null;
  const now = useMinute(waiting);

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
            : statusLabel(run, yours)}
          {waiting && run.expiresAt && (
            // How long the question stays open — it expires with the day, and a person
            // who only learns that by finding it expired has been told too late.
            <span className="agent-run-deadline">{` · ${timeLeft(run.expiresAt, now)}`}</span>
          )}
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
                setStopping(false);
                if (err instanceof ApiError && err.status === 404) {
                  // It ended before the press landed — the card just had not heard.
                  // Asking what it is doing now settles the card; an error saying "not
                  // running" about a card that says running would be the bug, twice.
                  void useStore.getState().reloadRuns();
                  return;
                }
                showError(err);
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

      {asking && yours && run.decision && (
        <DecisionAnswer key={run.id} run={run} decision={run.decision} />
      )}

      <ChainLine run={run} />

      {card && <RunWork card={card} />}
      {!running && run.seen && <SeenLine seen={run.seen} />}

      {/* What it is writing, as it writes it. A draft, set apart from the answer it will
          become: the message is posted once, finished, and this goes when it is. Plain
          text, because half a table or half a code fence through the markdown renderer
          reads as broken. Silent to a screen reader — announcing every few words of a
          sentence still being written would bury the conversation — and the answer
          itself arrives in the list, which does announce. */}
      {running && card?.textTail && (
        <div className="agent-run-draft" aria-live="off">
          <p className="agent-run-draft-text">{card.textTail}</p>
        </div>
      )}
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
  const hasWork =
    Boolean(
      card &&
        (card.steps.length > 0 ||
          card.tools.length > 0 ||
          (card.subagents?.length ?? 0) > 0 ||
          card.reasoning),
    ) || Boolean(run.seen);
  const said = [run.askedBy ? lineage(run) : '', statusLabel(run, false)].filter(Boolean);

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
      {open && (
        <div className="agent-run-line-work">
          <ChainLine run={run} />
          {card && <RunWork card={card} />}
          {run.seen && <SeenLine seen={run.seen} />}
        </div>
      )}
    </div>
  );
}

/**
 * The question a run is waiting on, answerable where the run is shown — the card under
 * the mention, and Home — by the one person who may answer it. The same answer the
 * buttons under the question post, through the same service: the person's own message,
 * then the agent carries on.
 */
function DecisionAnswer({ run, decision }: { run: AgentRunView; decision: AgentRunDecision }) {
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState('');
  // One id for this card's answer, so a press retried after a dropped response is the
  // same decision rather than a second one.
  const [clientActionId] = useState(() => `card-${crypto.randomUUID()}`);

  async function answer(given: { choice: number } | { value: string }) {
    setBusy(true);
    try {
      await api.agentRuns.answer(run.id, given, clientActionId);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = words.trim();
    if (value) void answer({ value });
  }

  return (
    <div className="agent-run-decision">
      <p className="agent-run-decision-prompt">{decision.prompt}</p>
      {decision.choices.length > 0 ? (
        <div className="agent-run-decision-choices" role="group" aria-label="Answer">
          {decision.choices.map((choice, index) => (
            <button
              key={`${index}-${choice.label}`}
              type="button"
              className="btn btn-agent"
              disabled={busy}
              onClick={() => void answer({ choice: index })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : (
        <form className="agent-run-decision-words" onSubmit={submit}>
          <input
            className="input"
            aria-label={`Answer ${run.agentName}`}
            value={words}
            maxLength={2000}
            disabled={busy}
            onChange={(event) => setWords(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !words.trim()}>
            Answer
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * What the run was shown, in one line: how much of the conversation, and what went with
 * it. The question every surprising answer raises — "what did it actually see?" —
 * answered without reading the job's code.
 */
export function SeenLine({ seen }: { seen: AgentRunSeen }) {
  const parts = [
    `Saw ${seen.messages} ${seen.messages === 1 ? 'message' : 'messages'} of this ${seen.window}`,
    seen.files > 0 ? `${seen.files} ${seen.files === 1 ? 'file' : 'files'}` : '',
    seen.instructions ? "the workspace's instructions" : '',
    seen.memory ? 'its memory here' : '',
    seen.task ? 'a task' : '',
    seen.tools.length > 0 ? `tools: ${seen.tools.join(', ')}` : '',
  ].filter(Boolean);
  return <div className="agent-run-seen">{parts.join(' · ')}</div>;
}

/** One link of a chain as the store holds it, flattened so a selector can compare it. */
function linkKey(run: AgentRunView): string {
  return [run.id, run.agentName, run.status, run.depth, run.startedAt].join('\u0000');
}

/**
 * The runs on this run's chain — the person's message at its root, and every agent a
 * reply set going from there (ADR 0013) — as one line, in order: who, and where this run
 * sits in it. Nothing for a run alone on its chain, which is nearly every run.
 *
 * Read from the runs the client holds, so a chain that reached another conversation shows
 * the part of it here. Selected as flat strings so a card's live snapshots, which replace
 * the run objects four times a second, do not redraw every card on the chain.
 */
function ChainLine({ run }: { run: AgentRunView }) {
  const links = useStore(
    useShallow((s) =>
      Object.values(s.agentRuns)
        .filter((other) => other.chainId === run.chainId)
        .map(linkKey),
    ),
  );
  if (links.length < 2) return null;

  const parsed = links
    .map((key) => {
      const [id = '', name = '', status = '', depth = '0', startedAt = ''] = key.split('\u0000');
      return { id, name, status, depth: Number(depth), startedAt };
    })
    .sort((a, b) => a.depth - b.depth || a.startedAt.localeCompare(b.startedAt));
  const hops = new Map<number, typeof parsed>();
  for (const link of parsed) hops.set(link.depth, [...(hops.get(link.depth) ?? []), link]);

  return (
    <div className="agent-run-chain">
      <span className="agent-run-chain-label">Chain</span>{' '}
      {[...hops.values()].map((same, index) => (
        <span key={same[0]?.id}>
          {index > 0 && ' → '}
          {same.map((link, at) => (
            <span key={link.id}>
              {at > 0 && ', '}
              {link.id === run.id ? (
                <strong aria-current="true">{link.name}</strong>
              ) : (
                <span data-status={link.status}>{link.name}</span>
              )}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}


function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 60_000) return 'closing now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m left to answer`;
  if (ms < 48 * 3_600_000) return `${Math.floor(ms / 3_600_000)}h left to answer`;
  return `${Math.floor(ms / 86_400_000)}d left to answer`;
}

/** What a run did: its plan, its tool calls and, behind a toggle, its reasoning. */
export function RunWork({ card }: { card: RunCard }) {
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

      {/* Delegated work reads like the plan: each subagent a row that says how it
          ended. Optional on the card, which was stored without it before AG-UI 1.0. */}
      {card.subagents && card.subagents.length > 0 && (
        <ol className="agent-run-steps agent-run-subagents" aria-label="Delegated to">
          {card.subagents.map((subagent, index) => (
            <li key={`${subagent.name}-${index}`} data-status={subagent.status}>
              <span className="agent-run-step-mark" aria-hidden>
                {subagent.status === 'done' ? '✓' : subagent.status === 'failed' ? '✕' : '•'}
              </span>
              {subagent.name}
              {subagent.status === 'failed' && ' — failed'}
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

function statusLabel(run: AgentRunView, yours: boolean): string {
  switch (run.status) {
    case 'succeeded':
      return [
        run.postCount > 0 ? '' : 'answered silently',
        durationLabel(run),
        // What the agent reported it cost, when it reported anything (AG-UI 1.0).
        run.tokens ? formatTokens(run.tokens) : '',
      ]
        .filter(Boolean)
        .join(' · ');
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
      // And only "your" answer to the one person who may give it: the card is the
      // whole channel's, and everybody else reading "your answer" was being told to
      // decide something they cannot.
      if (run.answeredAt) return 'answered';
      return yours ? 'waiting for your answer' : 'waiting for an answer';
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
