/** What the thread panel knows beyond the messages: the summary and the tasks.
 *
 * One request pair per thread, through `useFetch`, and one reducer for everything
 * that changes it afterwards — a refreshed summary, a task created or saved. The
 * cards that render these are presentational; this is the state.
 */

import { useEffect, useReducer } from "react";
import type { AgentTask, ThreadSummary } from "@blob/shared";
import { ApiError, api } from "../../lib/api.ts";
import { useFetch } from "../../lib/useFetch.ts";

interface Tools {
  summary: ThreadSummary | null;
  tasks: AgentTask[];
}

type Change =
  | { type: "loaded"; summary: ThreadSummary | null; tasks: AgentTask[] }
  | { type: "summary"; summary: ThreadSummary | null }
  | { type: "task.created"; task: AgentTask }
  | { type: "task.updated"; task: AgentTask };

function change(state: Tools, action: Change): Tools {
  switch (action.type) {
    case "loaded":
      return { summary: action.summary, tasks: action.tasks };
    case "summary":
      return { ...state, summary: action.summary };
    case "task.created":
      return { ...state, tasks: [action.task, ...state.tasks] };
    case "task.updated":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.task.id ? action.task : task,
        ),
      };
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function useThreadTools(rootId: string): {
  summary: ThreadSummary | null;
  tasks: AgentTask[];
  loading: boolean;
  error: string | null;
  apply: (action: Change) => void;
} {
  const { data, loading, error } = useFetch(
    async () => {
      const [summary, tasks] = await Promise.all([
        api.agentic.getThreadSummary(rootId),
        api.agentic.listThreadTasks(rootId),
      ]);
      return { summary: summary.summary, tasks: tasks.tasks };
    },
    [rootId],
  );
  const [state, apply] = useReducer(change, { summary: null, tasks: [] });
  useEffect(() => {
    if (data) apply({ type: "loaded", ...data });
  }, [data]);
  return {
    summary: state.summary,
    tasks: state.tasks,
    loading,
    error: error ? errorMessage(error, "Could not load the thread controls.") : null,
    apply,
  };
}

export type { Change as ThreadToolsChange };

export function formatWhen(value: string | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
