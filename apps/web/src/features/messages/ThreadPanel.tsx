/** The right panel's thread view: root message plus its replies and agentic helpers. */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AgentRunView,
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
  ThreadSummary,
} from "@blob/shared";
import { ApiError, api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { closeThread } from "../../lib/navigation.ts";
import { MessageList } from "./MessageList.tsx";
import { Composer } from "./Composer.tsx";
import { CloseIcon, PlusIcon } from "../../components/Icon.tsx";

interface TaskDraft {
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  assigneeUserId: string;
  outcome: string;
}

const TASK_STATUS_OPTIONS: Array<{ value: AgentTaskStatus; label: string }> = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const TASK_PRIORITY_OPTIONS: Array<{
  value: AgentTaskPriority;
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

function formatWhen(value: string | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function draftFor(task: AgentTask): TaskDraft {
  return {
    status: task.status,
    priority: task.priority,
    assigneeUserId: task.assigneeUserId ?? "",
    outcome: task.outcome ?? "",
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function ThreadPanel({ rootId }: { rootId: string }) {
  const thread = useStore((s) => s.threads[rootId]);
  const channels = useStore((s) => s.channels);
  const currentUser = useStore((s) => s.currentUser);
  const users = useStore((s) => s.users);
  const channelTitle = useStore((s) => s.channelTitle);

  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [priority, setPriority] = useState<AgentTaskPriority>("medium");

  // Slack opens a thread straight into root → replies → composer; the agentic cards are
  // this panel's departure from that, so they collapse behind a toggle by default.
  const [toolsOpen, setToolsOpen] = useState(() => {
    // localStorage can throw (private windows, blocked site data); default collapsed.
    try {
      return localStorage.getItem("blob.threadTools") === "open";
    } catch {
      return false;
    }
  });

  const [alsoSend, setAlsoSend] = useState(false);
  // The send wrapper below runs outside render and needs the current checkbox value.
  const agentRuns = useStore((s) => s.agentRuns);
  const runsByMessageId = useMemo(() => {
    const map: Record<string, AgentRunView[]> = {};
    for (const run of Object.values(agentRuns)) {
      if (run.threadRootId !== rootId || !run.triggerMessageId) continue;
      (map[run.triggerMessageId] ??= []).push(run);
    }
    return map;
  }, [agentRuns, rootId]);

  const alsoSendRef = useRef(alsoSend);
  useEffect(() => {
    alsoSendRef.current = alsoSend;
  }, [alsoSend]);

  const root = thread?.[0];
  const channel = root ? channels[root.channelId] : undefined;
  const replyCount = Math.max((thread?.length ?? 1) - 1, 0);
  const canManageAssignments = currentUser?.role !== "member";

  const toolsHintParts: string[] = [];
  if (!summaryLoading && summary) toolsHintParts.push("summary");
  if (!tasksLoading && tasks.length > 0) {
    toolsHintParts.push(
      `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
    );
  }
  const toolsHint = toolsHintParts.join(" · ");

  const assignees = useMemo(
    () =>
      Object.values(users)
        .filter((user) => !user.deactivated)
        .filter((user) => canManageAssignments || user.kind !== "bot")
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
    [canManageAssignments, users],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPanelData() {
      setSummaryLoading(true);
      setTasksLoading(true);
      setSummaryError(null);
      setTasksError(null);

      try {
        const [summaryResult, taskResult] = await Promise.all([
          api.agentic.getThreadSummary(rootId),
          api.agentic.listThreadTasks(rootId),
        ]);
        if (cancelled) return;
        setSummary(summaryResult.summary);
        setTasks(taskResult.tasks);
        setTaskDrafts(
          Object.fromEntries(
            taskResult.tasks.map((task) => [task.id, draftFor(task)]),
          ),
        );
      } catch (error) {
        if (cancelled) return;
        const message = errorMessage(
          error,
          "Could not load the thread controls.",
        );
        setSummaryError(message);
        setTasksError(message);
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
          setTasksLoading(false);
        }
      }
    }

    void loadPanelData();
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  function toggleTools() {
    setToolsOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("blob.threadTools", next ? "open" : "closed");
      } catch {
        // Persistence is a convenience; the toggle still works without it.
      }
      return next;
    });
  }

  async function refreshSummary() {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const result = await api.agentic.refreshThreadSummary(rootId);
      setSummary(result.summary);
    } catch (error) {
      setSummaryError(
        errorMessage(error, "Could not refresh the thread summary."),
      );
    } finally {
      setSummaryBusy(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;

    setCreateBusy(true);
    setCreateError(null);
    try {
      const result = await api.agentic.createThreadTask(rootId, {
        title: title.trim(),
        instructions: instructions.trim(),
        assigneeUserId: assigneeUserId || null,
        priority,
        summaryId: summary?.id ?? null,
      });
      setTasks((current) => [result.task, ...current]);
      setTaskDrafts((current) => ({
        ...current,
        [result.task.id]: draftFor(result.task),
      }));
      setTitle("");
      setInstructions("");
      setAssigneeUserId("");
      setPriority("medium");
      setCreateOpen(false);
    } catch (error) {
      setCreateError(errorMessage(error, "Could not create that task."));
    } finally {
      setCreateBusy(false);
    }
  }

  async function saveTask(task: AgentTask) {
    const draft = taskDrafts[task.id] ?? draftFor(task);
    const payload: {
      assigneeUserId?: string | null;
      status?: AgentTaskStatus;
      priority?: AgentTaskPriority;
      outcome?: string | null;
    } = {};

    if (draft.status !== task.status) payload.status = draft.status;
    if (draft.priority !== task.priority) payload.priority = draft.priority;
    if (canManageAssignments) {
      const nextAssignee = draft.assigneeUserId || null;
      if (nextAssignee !== (task.assigneeUserId ?? null))
        payload.assigneeUserId = nextAssignee;
    }
    const trimmedOutcome = draft.outcome.trim();
    if ((trimmedOutcome || null) !== (task.outcome ?? null)) {
      payload.outcome = trimmedOutcome || null;
    }
    if (Object.keys(payload).length === 0) return;

    setSavingTaskId(task.id);
    setTasksError(null);
    try {
      const result = await api.agentic.updateTask(task.id, payload);
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? result.task : item)),
      );
      setTaskDrafts((current) => ({
        ...current,
        [task.id]: draftFor(result.task),
      }));
    } catch (error) {
      setTasksError(errorMessage(error, "Could not update that task."));
    } finally {
      setSavingTaskId(null);
    }
  }

  function setTaskDraft(taskId: string, patch: Partial<TaskDraft>) {
    setTaskDrafts((current) => {
      const existing = current[taskId];
      return {
        ...current,
        [taskId]: {
          ...(existing ??
            draftFor(tasks.find((task) => task.id === taskId) as AgentTask)),
          ...patch,
        },
      };
    });
  }

  return (
    <aside className="panel" aria-label="Thread">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Thread</h2>
          <div className="panel-sub">
            {channel
              ? channel.name
                ? `#${channel.name}`
                : channelTitle(channel)
              : ""}
            {replyCount > 0 &&
              ` · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => closeThread()}
          title="Close thread"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      <div className="agentic-stack">
        <button
          className="btn btn-ghost"
          onClick={toggleTools}
          aria-expanded={toolsOpen}
        >
          {toolsOpen ? "Hide thread tools" : "Thread tools"}
          {!toolsOpen && toolsHint !== "" && (
            <span className="muted">{` · ${toolsHint}`}</span>
          )}
        </button>

        {toolsOpen && (
          <>
            <section
              className="agentic-card"
              aria-labelledby="thread-summary-title"
            >
              <div className="agentic-head">
                <div>
                  <div className="agentic-kicker">AI Summary</div>
                  <h3 className="agentic-title" id="thread-summary-title">
                    Catch up without rereading
                  </h3>
                </div>
                <button
                  className="btn"
                  onClick={() => void refreshSummary()}
                  disabled={summaryBusy}
                >
                  {summaryBusy ? "Working…" : summary ? "Refresh" : "Generate"}
                </button>
              </div>

              {summaryLoading ? (
                <div className="agentic-empty">Loading summary…</div>
              ) : summary ? (
                <div className="agentic-body">
                  <p className="summary-overview">{summary.overview}</p>
                  <div className="summary-meta">
                    {summary.provider} · {summary.messageCount} messages · updated{" "}
                    {formatWhen(summary.updatedAt)}
                  </div>

                  {summary.decisions.length > 0 && (
                    <div>
                      <div className="agentic-list-title">Decisions</div>
                      <ul className="agentic-list">
                        {summary.decisions.map((item, index) => (
                          <li key={`${item.messageId ?? "decision"}-${index}`}>
                            {item.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.actionItems.length > 0 && (
                    <div>
                      <div className="agentic-list-title">Action Items</div>
                      <ul className="agentic-list">
                        {summary.actionItems.map((item, index) => (
                          <li key={`${item.sourceMessageId ?? "action"}-${index}`}>
                            {item.text}
                            {item.assigneeUserId && (
                              <span className="agentic-inline-meta">
                                {" "}
                                ·{" "}
                                {users[item.assigneeUserId]?.displayName ??
                                  "Assigned"}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.openQuestions.length > 0 && (
                    <div>
                      <div className="agentic-list-title">Open Questions</div>
                      <ul className="agentic-list">
                        {summary.openQuestions.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="agentic-empty">
                  No thread summary yet. Generate one to capture decisions, action
                  items, and open questions.
                </div>
              )}

              {summaryError && <div className="error-text">{summaryError}</div>}
            </section>

            <section className="agentic-card" aria-labelledby="thread-tasks-title">
              <div className="agentic-head">
                <div>
                  <div className="agentic-kicker">Agent Tasks</div>
                  <h3 className="agentic-title" id="thread-tasks-title">
                    Coordinate people and agents
                  </h3>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => setCreateOpen((open) => !open)}
                >
                  <PlusIcon size={15} />
                  {createOpen ? "Hide" : "New task"}
                </button>
              </div>

              {createOpen && (
                <form className="agentic-form" onSubmit={createTask}>
                  <input
                    className="input"
                    placeholder="What needs to happen?"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={140}
                  />
                  <textarea
                    className="input agentic-textarea"
                    placeholder="Add context or handoff instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    maxLength={4000}
                  />
                  <div className="agentic-grid">
                    <select
                      className="input"
                      value={assigneeUserId}
                      onChange={(event) => setAssigneeUserId(event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName}
                          {user.kind === "bot" ? " (Agent)" : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={priority}
                      onChange={(event) =>
                        setPriority(event.target.value as AgentTaskPriority)
                      }
                    >
                      {TASK_PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="agentic-actions">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={createBusy || !title.trim()}
                    >
                      {createBusy ? "Creating…" : "Create task"}
                    </button>
                  </div>
                  {createError && <div className="error-text">{createError}</div>}
                </form>
              )}

              {tasksLoading ? (
                <div className="agentic-empty">Loading tasks…</div>
              ) : tasks.length === 0 ? (
                <div className="agentic-empty">
                  No tasks yet. Turn the thread into a tracked handoff for a
                  teammate or agent.
                </div>
              ) : (
                <div className="task-list">
                  {tasks.map((task) => {
                    const draft = taskDrafts[task.id] ?? draftFor(task);
                    return (
                      <article className="task-card" key={task.id}>
                        <div className="task-head">
                          <div>
                            <div className="task-title">{task.title}</div>
                            <div className="task-meta">
                              <span
                                className="task-badge"
                                data-tone={draft.priority}
                              >
                                {draft.priority.replace("_", " ")}
                              </span>
                              <span className="task-badge" data-tone={draft.status}>
                                {draft.status.replace("_", " ")}
                              </span>
                              <span>
                                {task.assigneeUserId
                                  ? (users[task.assigneeUserId]?.displayName ??
                                    "Assigned")
                                  : "Unassigned"}
                                {task.assigneeKind === "bot" ? " · Agent" : ""}
                              </span>
                            </div>
                          </div>
                          <button
                            className="btn btn-ghost"
                            onClick={() => void saveTask(task)}
                            disabled={savingTaskId === task.id}
                          >
                            {savingTaskId === task.id ? "Saving…" : "Save"}
                          </button>
                        </div>

                        {task.instructions && (
                          <div className="task-copy">{task.instructions}</div>
                        )}

                        <div className="agentic-grid">
                          <select
                            className="input"
                            value={draft.status}
                            onChange={(event) =>
                              setTaskDraft(task.id, {
                                status: event.target.value as AgentTaskStatus,
                              })
                            }
                          >
                            {TASK_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>

                          <select
                            className="input"
                            value={draft.priority}
                            onChange={(event) =>
                              setTaskDraft(task.id, {
                                priority: event.target.value as AgentTaskPriority,
                              })
                            }
                          >
                            {TASK_PRIORITY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="agentic-grid">
                          <select
                            className="input"
                            value={draft.assigneeUserId}
                            onChange={(event) =>
                              setTaskDraft(task.id, {
                                assigneeUserId: event.target.value,
                              })
                            }
                            disabled={!canManageAssignments}
                          >
                            <option value="">Unassigned</option>
                            {assignees.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.displayName}
                                {user.kind === "bot" ? " (Agent)" : ""}
                              </option>
                            ))}
                          </select>

                          <div className="task-dates">
                            <span>Updated {formatWhen(task.updatedAt)}</span>
                            <span>Completed {formatWhen(task.completedAt)}</span>
                          </div>
                        </div>

                        <textarea
                          className="input agentic-textarea"
                          placeholder="Optional outcome or completion note"
                          value={draft.outcome}
                          onChange={(event) =>
                            setTaskDraft(task.id, {
                              outcome: event.target.value,
                            })
                          }
                          maxLength={4000}
                        />
                      </article>
                    );
                  })}
                </div>
              )}

              {tasksError && <div className="error-text">{tasksError}</div>}
            </section>
          </>
        )}
      </div>

      <MessageList
        messages={thread ?? []}
        runsByMessageId={runsByMessageId}
        hasMore={false}
        loading={!thread}
        onLoadOlder={() => {}}
        onOpenThread={() => {}}
        unreadAfterId={null}
        inThread
      />

      {root && (
        <>
          <label
            className="muted"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px var(--pane-gutter) 0",
            }}
          >
            <input
              type="checkbox"
              checked={alsoSend}
              onChange={(event) => setAlsoSend(event.target.checked)}
            />
            <span>
              Also send to{" "}
              {channel
                ? channel.name
                  ? `#${channel.name}`
                  : channelTitle(channel)
                : "channel"}
            </span>
          </label>
          <Composer
            channelId={root.channelId}
            threadRootId={rootId}
            placeholder="Reply in thread"
            initialFocus
            consumeAlsoInChannel={() => {
              const ticked = alsoSendRef.current;
              // Slack's contract: the tick applies to the one message being sent.
              if (ticked) setAlsoSend(false);
              return ticked;
            }}
          />
        </>
      )}
    </aside>
  );
}
