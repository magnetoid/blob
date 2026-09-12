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

export function ThreadTasksCard({
  rootId,
  tasks,
  loading,
  error,
  summaryId,
  assignees,
  canManageAssignments,
  users,
  apply,
}: {
  rootId: string;
  tasks: AgentTask[];
  loading: boolean;
  error: string | null;
  summaryId: string | null;
  assignees: User[];
  canManageAssignments: boolean;
  users: Record<string, User>;
  apply: (change: ThreadToolsChange) => void;
}) {
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
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
      apply({ type: "task.created", task: result.task });
      setTaskDrafts((current) => ({
        ...current,
        [result.task.id]: draftFor(result.task),
      }));
      setForm(EMPTY_TASK);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(errorMessage(err, "Could not create that task."));
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
    setSaveError(null);
    try {
      const result = await api.agentic.updateTask(task.id, payload);
      apply({ type: "task.updated", task: result.task });
      setTaskDrafts((current) => ({
        ...current,
        [task.id]: draftFor(result.task),
      }));
    } catch (err) {
      setSaveError(errorMessage(err, "Could not update that task."));
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

  const shown = saveError ?? error;
  return (
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

      {shown && <div className="error-text">{shown}</div>}
    </section>
  );
}
