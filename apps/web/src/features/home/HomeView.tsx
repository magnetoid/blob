/** The first screen: what needs you, what agents are doing, ask one.
 *
 * Conversations stay in channels. This is the Slack home that Blob never had —
 * a live board, not a settings form, so a team that wants to move fast does not
 * start by hunting #general.
 *
 * And a board you can act on, not only read. An agent's question is shown and answered
 * here; a task is ticked off here; everything unread is cleared here. Each of those
 * answers in place — the answer confirmed, then the row leaving — because an action that
 * sends you somewhere else to finish it was the board's commonest dead end. Motion here
 * only ever answers something somebody did: a number that changed ticks, a row that is
 * done leaves. Nothing animates for arriving on the page; switching views stays instant
 * (CLAUDE.md, "motion is keyed to arriving").
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AgentRunView, AgentTask } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useRun, useRunIds } from '../../lib/useRuns.ts';
import { agentIsAvailable } from '../../lib/conversations.ts';
import { showChannel, showThread } from '../../lib/navigation.ts';
import { navigate } from '../../lib/router.ts';
import { showError } from '../../lib/toasts.ts';
import { FALLBACK_MS } from '../../lib/usePresence.ts';
import { useMinute } from '../../lib/useMinute.ts';
import {
  CheckIcon,
  FileIcon,
  MembersIcon,
  MentionIcon,
  SendIcon,
  SparkIcon,
} from '../../components/Icon.tsx';
import { Avatar } from '../../components/Avatar.tsx';
import { Count } from '../../components/Count.tsx';
import { AgentRunCard } from '../messages/AgentRunCard.tsx';
import { ListSkeleton } from '../../components/ListSkeleton.tsx';
import { formatRelative } from '../messages/messageFormatting.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { RecentDecisions } from './RecentDecisions.tsx';

/** How long an answered question or a ticked-off task stays to say so, before it leaves. */
export const CONFIRM_MS = 1600;

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
  const running = useRunIds((r) => r.status === 'running' || r.status === 'waiting', oldestFirst);
  // Yours to decide: only the person a run is on behalf of may answer it, so somebody
  // else's question is not something that needs you, however visible its card is.
  const waiting = useRunIds(
    (r) => r.status === 'interrupted' && !r.answeredAt && me !== null && r.initiatedByUserId === me,
    oldestFirst,
  );
  const doneToday = useRunIds((r) => r.status === 'succeeded' && r.finishedAt !== null, newestFinished);

  // A question answered here stays to say so, then leaves — and stays gone: the store
  // learns the run was answered only when the resumed run's events arrive, and a row
  // that came back in the gap would ask again something already answered.
  const answers = useSettling();
  const decisionIds = mergeIds(
    waiting.filter((id) => !answers.gone.has(id)),
    [...answers.held.keys()].filter((id) => !answers.gone.has(id)),
  );
  const pending = waiting.filter((id) => !answers.gone.has(id) && !answers.held.has(id));

  // A task ticked off here, the same way: checked at once, then gone from the list.
  const ticked = useSettling();
  const openTasks = (tasks ?? []).filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled' && !ticked.gone.has(t.id),
  );
  const openTaskCount = openTasks.filter((t) => !ticked.held.has(t.id)).length;

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

  async function completeTask(task: AgentTask, keyboard: boolean) {
    ticked.hold(task.id, 'done', keyboard);
    try {
      await api.agentic.updateTask(task.id, { status: 'done' });
      ticked.settleAfter(task.id, CONFIRM_MS);
    } catch (err) {
      ticked.release(task.id);
      showError(err);
    }
  }

  const mentions = unread.reduce((n, c) => n + (c.mentionCount || 0), 0);
  const needsYou = pending.length + mentions;

  // "Needs you" counts decisions as well as mentions, and only this page shows both: the
  // decisions in their card, the mentions as green pills in Unread. So the tile takes you
  // down the page to them rather than away from it — to the decisions first, which are an
  // agent stopped until you answer. The mentions page cannot show a decision at all.
  const decisionsRef = useRef<HTMLElement>(null);
  const unreadRef = useRef<HTMLElement>(null);
  const tasksRef = useRef<HTMLElement>(null);
  const showCard = useCallback((card: HTMLElement | null) => {
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
    card.focus({ preventScroll: true });
  }, []);
  function showWhatNeedsYou() {
    showCard(pending.length > 0 ? decisionsRef.current : unreadRef.current);
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
            morning used to say. Each part of it is a way to what it counts. */}
        <section className="home-hero" aria-label="Where you stand">
          <p className="home-greeting">
            {greeting(new Date())}
            {firstName && `, ${firstName}`}
          </p>
          <Summary
            decisions={pending.length}
            mentions={mentions}
            conversations={unread.length}
            onDecisions={() => showCard(decisionsRef.current)}
            onMentions={() => navigate('/mentions')}
            onConversations={() => showCard(unreadRef.current)}
          />
        </section>

        {/* Meadow's ambient strip: the product's ✦ and a line to type in. A composer, so it
            is allowed the composer's lift and the composer's ring when focused. */}
        {/* Not for a guest: their message starts no agent run (ADR 0034). */}
        {currentUser?.role !== 'guest' && (
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
        )}

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
            onOpen={() => navigate('/agents')}
          />
          <Stat
            label="Open tasks"
            value={openTaskCount}
            icon={<FileIcon size="md" />}
            onOpen={() => navigate('/tasks')}
          />
          <Stat
            label="Here now"
            value={peopleHere.length}
            tone="clay"
            icon={<MembersIcon size="md" />}
            faces={peopleHere.slice(0, 3).map((person) => (
              <Avatar key={person.id} user={person} size="sm" />
            ))}
          />
        </div>

        <div className="home-grid">
          {/* The heading stays the section's first child, with its count a sibling rather
              than inside it: inside, the count would become part of the heading's name. */}
          <section className="home-card" ref={decisionsRef} tabIndex={-1}>
            <h2>Needs a decision</h2>
            <CardCount value={pending.length} />
            {decisionIds.length === 0 && <p className="muted">Nothing waiting.</p>}
            {decisionIds.map((runId) => (
              <Collapse
                key={runId}
                leaving={answers.leaving.has(runId)}
                onGone={() => {
                  if (answers.forget(runId)) decisionsRef.current?.focus({ preventScroll: true });
                }}
              >
                <DecisionRow
                  runId={runId}
                  answered={answers.held.get(runId) ?? null}
                  onAnswered={(label, keyboard) => {
                    answers.hold(runId, label, keyboard);
                    answers.settleAfter(runId, CONFIRM_MS);
                  }}
                />
              </Collapse>
            ))}
          </section>

          <section className="home-card">
            <h2>Agents live</h2>
            <CardCount value={running.length} />
            {running.length === 0 && <p className="muted">No agent is working right now.</p>}
            {running.map((runId) => (
              <HomeRun key={runId} runId={runId} />
            ))}
            <div className="home-card-foot">
              <button type="button" className="home-card-link" onClick={() => navigate('/agents')}>
                All agents
              </button>
            </div>
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
            {unread.length > 0 && (
              <div className="home-card-foot">
                {/* Slack's Shift+Esc, as a button: every channel's cursor to its newest
                    message, and the list above empties as the answer arrives. */}
                <button
                  type="button"
                  className="home-card-link"
                  onClick={() => void useStore.getState().markAllRead().catch(showError)}
                >
                  Mark all read
                </button>
              </div>
            )}
          </section>

          <section className="home-card" ref={tasksRef} tabIndex={-1}>
            <h2>Your tasks</h2>
            <CardCount value={openTaskCount} />
            {tasks === null && <ListSkeleton rows={2} avatar="none" />}
            {tasks && openTasks.length === 0 && <p className="muted">Nothing queued for you.</p>}
            {openTasks.slice(0, 8).map((task) => (
              <Collapse
                key={task.id}
                leaving={ticked.leaving.has(task.id)}
                onGone={() => {
                  if (ticked.forget(task.id)) tasksRef.current?.focus({ preventScroll: true });
                }}
              >
                <TaskRow
                  task={task}
                  done={ticked.held.has(task.id)}
                  onDone={(keyboard) => void completeTask(task, keyboard)}
                />
              </Collapse>
            ))}
            {openTasks.length > 0 && (
              <div className="home-card-foot">
                <button type="button" className="home-card-link" onClick={() => navigate('/tasks')}>
                  All tasks
                </button>
              </div>
            )}
          </section>
        </div>

        <RecentDecisions />

        {/* Who is here is in its tile, as faces; Pulse is what the agents finished. */}
        {doneToday.length > 0 && (
          <section className="home-card home-pulse">
            <h2>Pulse</h2>
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

/** Whether a control was reached from the keyboard: it shows a focus ring only then. A
 *  browser that cannot answer the question is treated as the mouse, which loses nothing. */
function fromKeys(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** Two id lists as one, oldest first, each id once. Ids are UUIDv7, so their order is the
 *  order the runs began: a row answered here keeps its place while it says so. */
function mergeIds(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

/**
 * Rows somebody acted on here, through the three beats every one of them has: held (it
 * says what was done), leaving (it closes), gone (it stays out of the list). Kept by id,
 * so it serves the questions and the tasks alike.
 */
function useSettling() {
  const [held, setHeld] = useState<ReadonlyMap<string, string>>(new Map());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());
  // Rows acted on from the keyboard, whose focus has to land somewhere when they go.
  const fromKeyboard = useRef(new Set<string>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  return {
    held,
    leaving,
    gone,
    hold: (id: string, how: string, keyboard = false) => {
      if (keyboard) fromKeyboard.current.add(id);
      setHeld((m) => new Map(m).set(id, how));
    },
    release: (id: string) =>
      setHeld((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      }),
    settleAfter: (id: string, ms: number) => {
      timers.current.set(
        id,
        window.setTimeout(() => setLeaving((s) => new Set(s).add(id)), ms),
      );
    },
    /** The row is gone. True when it had been acted on from the keyboard, so the caller
     *  can put focus somewhere other than the top of the document. */
    forget: (id: string): boolean => {
      setGone((s) => (s.has(id) ? s : new Set(s).add(id)));
      setLeaving((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      return fromKeyboard.current.delete(id);
    },
  };
}

/**
 * A row that leaves by closing: its height folds to nothing as it fades, so the rows
 * under it close the gap rather than jump into it. Gone when the fade ends — or after
 * `FALLBACK_MS` if no transition runs at all, which is what reduced motion and a test
 * environment both do.
 */
function Collapse({
  leaving,
  onGone,
  children,
}: {
  leaving: boolean;
  onGone: () => void;
  children: ReactNode;
}) {
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => gone.current(), FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return (
    <div
      className="home-collapse"
      data-state={leaving ? 'closed' : 'open'}
      inert={leaving || undefined}
      onTransitionEnd={(event) => {
        if (leaving && event.target === event.currentTarget && event.propertyName === 'opacity') {
          gone.current();
        }
      }}
    >
      <div className="home-collapse-inner">{children}</div>
    </div>
  );
}

/**
 * A question an agent stopped to ask you, and the way to answer it without leaving.
 *
 * The question itself, then its choices as buttons or a line to type — the same answer
 * the buttons under the message give, sent to the run (`api.agentRuns.answer`) and
 * posted as your own message, so the channel still sees what was decided. Answered, the
 * row says so for a moment and leaves. A run whose question Blob cannot draw here keeps
 * the way to the conversation, which is where the question always is.
 */
function DecisionRow({
  runId,
  answered,
  onAnswered,
}: {
  runId: string;
  answered: string | null;
  onAnswered: (label: string, keyboard: boolean) => void;
}) {
  const run = useRun(runId);
  const channel = useStore((s) => (run ? s.channels[run.channelId] : undefined));
  const channelTitle = useStore((s) => s.channelTitle);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState('');
  const now = useMinute(Boolean(run?.expiresAt) && !answered);
  // The question as last seen. Once answered, the server stops sending it — the run is no
  // longer asking — but the row still has a moment to say what was answered, and should
  // say it under the question rather than under "waiting for your answer". Kept during
  // render, the way `Count` keeps its last number, rather than an effect a frame late.
  const asked = run?.decision?.prompt ?? null;
  const [lastAsked, setLastAsked] = useState(asked);
  if (asked !== null && asked !== lastAsked) setLastAsked(asked);
  // One id for this answer however many times it is sent: a retry after a dropped
  // response is the same answer, and the server keeps one.
  const actionId = useRef(crypto.randomUUID());
  if (!run) return null;

  const where = channel ? channelTitle(channel) : 'the conversation';
  const decision = run.decision ?? null;
  const go = () =>
    void (run.threadRootId ? showThread(run.channelId, run.threadRootId) : showChannel(run.channelId));

  async function send(
    answer: { choice: number } | { value: string },
    label: string,
    keyboard: boolean,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      await api.agentRuns.answer(runId, answer, actionId.current);
      onAnswered(label, keyboard);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home-decision" data-state={answered ? 'answered' : 'open'}>
      <div className="home-decision-head">
        <span className="home-decision-agent">{run.agentName}</span>
        <button type="button" className="home-decision-where" onClick={go}>
          {where}
        </button>
        {run.expiresAt && !answered && (
          <span className="home-decision-due">{timeLeft(run.expiresAt, now)}</span>
        )}
      </div>
      <p className="home-decision-prompt">
        {decision?.prompt ?? lastAsked ?? `${run.agentName} is waiting for your answer.`}
      </p>
      {answered ? (
        <p className="home-decision-done" role="status">
          <span className="home-decision-check" aria-hidden="true">
            <CheckIcon size="sm" />
          </span>
          Answered {answered}. {run.agentName} carries on in {where}.
        </p>
      ) : decision && decision.choices.length > 0 ? (
        <div className="home-decision-choices" role="group" aria-label={`Answer ${run.agentName}`}>
          {decision.choices.map((choice, index) => (
            <button
              key={`${index}-${choice.label}`}
              type="button"
              className="btn"
              disabled={busy}
              onClick={(event) =>
                void send({ choice: index }, `“${choice.label}”`, fromKeys(event.currentTarget))
              }
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : decision?.freeText ? (
        <form
          className="home-decision-reply"
          onSubmit={(event) => {
            event.preventDefault();
            const text = words.trim();
            // Words are typed, so whatever sent them, focus was the keyboard's.
            if (text) void send({ value: text }, 'in your own words', true);
          }}
        >
          <input
            className="input"
            value={words}
            onChange={(event) => setWords(event.target.value)}
            placeholder="Your answer…"
            aria-label={`Answer ${run.agentName}`}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !words.trim()}>
            Send
          </button>
        </form>
      ) : (
        <button type="button" className="home-card-link" onClick={go}>
          Answer in {where}
        </button>
      )}
    </div>
  );
}

/** One of your tasks: a box to tick it off, its title the way to its thread. */
function TaskRow({
  task,
  done,
  onDone,
}: {
  task: AgentTask;
  done: boolean;
  onDone: (keyboard: boolean) => void;
}) {
  const open = () =>
    void (task.threadRootId ? showThread(task.channelId, task.threadRootId) : showChannel(task.channelId));
  const urgent = task.priority === 'high' || task.priority === 'critical';
  return (
    <div className="home-task" data-done={done ? 'true' : undefined}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Mark “${task.title}” done`}
        className="home-check"
        // Not `disabled`: a disabled button drops the focus it holds, and a keyboard user
        // who just ticked this would be thrown back to the top of the page.
        aria-disabled={done || undefined}
        onClick={(event) => {
          if (!done) onDone(fromKeys(event.currentTarget));
        }}
      >
        {done && <CheckIcon size="sm" />}
      </button>
      <button type="button" className="home-task-title" onClick={open}>
        {task.title}
      </button>
      {task.dueAt && <span className="home-task-due">due {formatRelative(task.dueAt)}</span>}
      {task.status !== 'todo' ? (
        <span className="home-pill">{task.status.replace('_', ' ')}</span>
      ) : (
        urgent && (
          <span className="home-pill" data-tone="clay">
            {task.priority}
          </span>
        )
      )}
    </div>
  );
}

/**
 * One run on the board: the way to its conversation, and its card. It subscribes to its
 * own run, so a live snapshot redraws this row and nothing else on Home.
 */
function HomeRun({ runId }: { runId: string }) {
  const run = useRun(runId);
  const channel = useStore((s) => (run ? s.channels[run.channelId] : undefined));
  const channelTitle = useStore((s) => s.channelTitle);
  if (!run) return null;
  return (
    <div className="home-run">
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
      </button>
      <AgentRunCard run={run} />
    </div>
  );
}

function DoneLine({ runId }: { runId: string }) {
  const run = useRun(runId);
  const channel = useStore((s) => (run ? s.channels[run.channelId] : undefined));
  const channelTitle = useStore((s) => s.channelTitle);
  if (!run) return null;
  return (
    <button type="button" className="home-row" onClick={() => void showChannel(run.channelId)}>
      <span className="min-0 ellipsis">
        <strong>{run.agentName}</strong> finished
        {channel ? ` in ${channelTitle(channel)}` : ''}
      </span>
      <span className="muted">{formatRelative(run.finishedAt ?? run.startedAt)}</span>
    </button>
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

/** How long a question has before it lapses, short, for the row it sits in. */
function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'closing';
  if (ms < 3_600_000) return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
  if (ms < 48 * 3_600_000) return `${Math.floor(ms / 3_600_000)}h left`;
  return `${Math.floor(ms / 86_400_000)}d left`;
}

/**
 * Where you stand, in one sentence, from the same counts the tiles show — and each part
 * of it the way to what it counts: the decisions and the unread conversations on this
 * page, the mentions on the page that lists them.
 */
function Summary({
  decisions,
  mentions,
  conversations,
  onDecisions,
  onMentions,
  onConversations,
}: {
  decisions: number;
  mentions: number;
  conversations: number;
  onDecisions: () => void;
  onMentions: () => void;
  onConversations: () => void;
}) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    decisions > 0 && {
      text: plural(decisions, 'decision waiting on you', 'decisions waiting on you'),
      go: onDecisions,
    },
    mentions > 0 && { text: plural(mentions, 'mention', 'mentions'), go: onMentions },
    conversations > 0 && {
      text: plural(conversations, 'conversation with something new', 'conversations with something new'),
      go: onConversations,
    },
  ].filter((part): part is { text: string; go: () => void } => Boolean(part));
  if (parts.length === 0) return <p className="home-summary">You are all caught up.</p>;
  return (
    <p className="home-summary">
      {parts.map((part, index) => (
        <span key={part.text}>
          {index > 0 && (index === parts.length - 1 ? ' and ' : ', ')}
          <button type="button" className="home-summary-link" onClick={part.go}>
            {part.text}
          </button>
        </span>
      ))}
      .
    </p>
  );
}

/**
 * One number on the board, with what it counts and where to go about it. A button when
 * there is somewhere to go — the mentions, the task list, the agents — and a plain tile
 * when there is not. The number ticks when it changes in front of you (`Count`), never
 * when the page is drawn.
 */
function Stat({
  label,
  value,
  icon,
  tone,
  live,
  faces,
  onOpen,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'accent' | 'iris' | 'clay';
  live?: boolean;
  faces?: ReactNode[];
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
      <span className="home-stat-foot">
        <span
          className="home-stat-value"
          data-live={live ? 'true' : undefined}
          data-zero={value === 0 ? 'true' : undefined}
        >
          <Count value={value} className="home-stat-digits" />
        </span>
        {faces && faces.length > 0 && (
          <span className="home-faces" aria-hidden="true">
            {faces}
          </span>
        )}
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

/** How many a card holds, beside its heading, ticking as it changes. Nothing at all for
 *  none: the card's own empty line already says so. */
function CardCount({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span className="home-card-count">
      <Count value={value} className="home-card-digits" />
    </span>
  );
}
