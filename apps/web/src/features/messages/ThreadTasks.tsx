/** The tasks card: the thread as a tracked handoff between people and agents. */

import { useState, type FormEvent } from "react";
import type {
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
  User,
} from "@blob/shared";
import { api } from "../../lib/api.ts";
import { PlusIcon } from "../../components/Icon.tsx";
import { errorMessage, formatWhen, type ThreadToolsChange } from "./threadTools.ts";

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

function draftFor(task: AgentTask): TaskDraft {
  return {
    status: task.status,
    priority: task.priority,
    assigneeUserId: task.assigneeUserId ?? "",
    outcome: task.outcome ?? "",
  };
}

interface NewTask {
  title: string;
  instructions: string;
  assigneeUserId: string;
  priority: AgentTaskPriority;
}

const EMPTY_TASK: NewTask = {
  title: "",
  instructions: "",
  assigneeUserId: "",
  priority: "medium",
};

/** Said under a picker the moment an agent is chosen: handing it a task is not only a
 * field changing, it posts a message in the thread and sets the agent going. */
function HandOffNote({ name }: { name: string }) {
  return (
    <div className="agentic-note">
      {name} gets a hand-off in this thread from you and starts on it. The task moves when
      it answers.
    </div>
  );
}

export function ThreadTasksCard({
  rootId,
  tasks,
  loading,
  error,
  summaryId,
  assignees,
  mayReassign,
  users,
  apply,
}: {
  rootId: string;
  tasks: AgentTask[];
  loading: boolean;
  error: string | null;
  summaryId: string | null;
  /** Who a task here may go to: people, and the agents this person may hand work. */
  assignees: User[];
  /** Whether this person may change who has this task. */
  mayReassign: (task: AgentTask) => boolean;
  users: Record<string, User>;
  apply: (change: ThreadToolsChange) => void;
}) {
  // Only the fields a person has touched, per task. The rest of the card is the task as
  // it is now: a frozen copy of every field went stale the moment the task moved under
  // it — an agent finishing it, say — and a save sent the stale status back, reopening
  // finished work from a priority change (review of phase 3).
  const [taskEdits, setTaskEdits] = useState<Record<string, Partial<TaskDraft>>>({});
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState<NewTask>(EMPTY_TASK);
  const { title, instructions, assigneeUserId, priority } = form;
  const edit = (patch: Partial<NewTask>) => setForm((f) => ({ ...f, ...patch }));

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
        summaryId,
      });
      // No draft for it: the card shows the task as it is until somebody edits it, so a
      // task handed to an agent shows done when the agent answers, not what it was here.
      apply({ type: "task.created", task: result.task });
      setForm(EMPTY_TASK);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(errorMessage(err, "Could not create that task."));
    } finally {
      setCreateBusy(false);
    }
  }

  async function saveTask(task: AgentTask) {
    // What was touched and still differs from the task as it stands — nothing else is
    // sent, so a field somebody else changed meanwhile is never put back.
    const edits = taskEdits[task.id] ?? {};
    const payload: {
      assigneeUserId?: string | null;
      status?: AgentTaskStatus;
      priority?: AgentTaskPriority;
      outcome?: string | null;
    } = {};

    if (edits.status !== undefined && edits.status !== task.status)
      payload.status = edits.status;
    if (edits.priority !== undefined && edits.priority !== task.priority)
      payload.priority = edits.priority;
    if (edits.assigneeUserId !== undefined && mayReassign(task)) {
      const nextAssignee = edits.assigneeUserId || null;
      if (nextAssignee !== (task.assigneeUserId ?? null))
        payload.assigneeUserId = nextAssignee;
    }
    if (edits.outcome !== undefined) {
      const trimmedOutcome = edits.outcome.trim();
      if ((trimmedOutcome || null) !== (task.outcome ?? null)) {
        payload.outcome = trimmedOutcome || null;
      }
    }
    if (Object.keys(payload).length === 0) return;

    setSavingTaskId(task.id);
    setSaveError(null);
    try {
      const result = await api.agentic.updateTask(task.id, payload);
      apply({ type: "task.updated", task: result.task });
      // Saved, so nothing is pending: the card follows the task again.
      setTaskEdits((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    } catch (err) {
      setSaveError(errorMessage(err, "Could not update that task."));
    } finally {
      setSavingTaskId(null);
    }
  }

  function setTaskDraft(taskId: string, patch: Partial<TaskDraft>) {
    setTaskEdits((current) => ({
      ...current,
      [taskId]: { ...current[taskId], ...patch },
    }));
  }

  const shown = saveError ?? error;
  const isAgent = (userId: string) => users[userId]?.kind === "bot";
  return (
    <section className="agentic-card" aria-labelledby="thread-tasks-title">
      <div className="agentic-head">
        <div>
          <div className="agentic-kicker">Agent tasks</div>
          <h3 className="agentic-title" id="thread-tasks-title">
            Coordinate people and agents
          </h3>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setCreateOpen((open) => !open)}
        >
          <PlusIcon size="md" />
          {createOpen ? "Hide" : "New task"}
        </button>
      </div>

      {createOpen && (
        <form className="agentic-form" onSubmit={createTask}>
          <input
            className="input"
            placeholder="What needs to happen?"
            value={title}
            onChange={(event) => edit({ title: event.target.value })}
            maxLength={140}
          />
          <textarea
            className="input agentic-textarea"
            placeholder="Add context or handoff instructions"
            value={instructions}
            onChange={(event) => edit({ instructions: event.target.value })}
            maxLength={4000}
          />
          <div className="agentic-grid">
            <select
              className="input"
              aria-label="Assign to"
              value={assigneeUserId}
              onChange={(event) => edit({ assigneeUserId: event.target.value })}
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
              aria-label="Priority"
              value={priority}
              onChange={(event) =>
                edit({ priority: event.target.value as AgentTaskPriority })
              }
            >
              {TASK_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {assigneeUserId && isAgent(assigneeUserId) && (
            <HandOffNote name={users[assigneeUserId]?.displayName ?? "The agent"} />
          )}
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

      {loading ? (
        <div className="agentic-empty">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="agentic-empty">
          No tasks yet. Turn the thread into a tracked handoff for a
          teammate or agent.
        </div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => {
            // The task as it is, with what this person has touched laid over it.
            const draft = { ...draftFor(task), ...taskEdits[task.id] };
            const reassignable = mayReassign(task);
            // Whoever has it now stays in the list even when it is not somebody this
            // person could pick — an agent they may not command, someone since gone —
            // or the picker would claim the task is unassigned.
            const holder = task.assigneeUserId;
            const holderListed =
              holder === null || assignees.some((user) => user.id === holder);
            // The two saves that hand a task to an agent (ADR 0023): giving it to one, and
            // moving an agent's task back to in progress — the retry.
            const handingTo =
              draft.assigneeUserId &&
              draft.assigneeUserId !== (task.assigneeUserId ?? "") &&
              isAgent(draft.assigneeUserId)
                ? draft.assigneeUserId
                : holder !== null &&
                    draft.assigneeUserId === holder &&
                    isAgent(holder) &&
                    draft.status === "in_progress" &&
                    task.status !== "in_progress"
                  ? holder
                  : null;
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
                    aria-label="Status"
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
                    aria-label="Priority"
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
                    aria-label="Assigned to"
                    value={draft.assigneeUserId}
                    onChange={(event) =>
                      setTaskDraft(task.id, {
                        assigneeUserId: event.target.value,
                      })
                    }
                    disabled={!reassignable}
                  >
                    <option value="">Unassigned</option>
                    {!holderListed && holder !== null && (
                      <option value={holder}>
                        {users[holder]?.displayName ?? "Someone no longer here"}
                        {task.assigneeKind === "bot" ? " (Agent)" : ""}
                      </option>
                    )}
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

                {handingTo && (
                  <HandOffNote
                    name={users[handingTo]?.displayName ?? "The agent"}
                  />
                )}

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

      {shown && <div className="error-text">{shown}</div>}
    </section>
  );
}
