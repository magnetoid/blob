/** `api.agentic` — see `lib/api.ts` for the assembled client. */

import type {
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
  ThreadSummary,
} from "@blob/shared";
import { get, post, patch } from "./client.ts";

export const agentic = {
  catchup: (channelId: string | null) =>
    post<{
      summaries: Array<{
        channelId: string;
        channelName: string | null;
        text: string;
        messageCount: number;
        upToMessageId: string;
      }>;
    }>("/api/catchup", { channelId }),
  getThreadSummary: (messageId: string) =>
    get<{ summary: ThreadSummary | null }>(
      `/api/threads/${messageId}/summary`,
    ),
  refreshThreadSummary: (messageId: string) =>
    post<{ summary: ThreadSummary }>(`/api/threads/${messageId}/summary`),
  listThreadTasks: (messageId: string) =>
    get<{ tasks: AgentTask[] }>(`/api/threads/${messageId}/tasks`),
  createThreadTask: (
    messageId: string,
    input: {
      title: string;
      instructions?: string;
      assigneeUserId?: string | null;
      priority?: AgentTaskPriority;
      dueAt?: string | null;
      summaryId?: string | null;
      externalRef?: Record<string, string>;
    },
  ) => post<{ task: AgentTask }>(`/api/threads/${messageId}/tasks`, input),
  updateTask: (
    taskId: string,
    input: {
      assigneeUserId?: string | null;
      status?: AgentTaskStatus;
      priority?: AgentTaskPriority;
      dueAt?: string | null;
      outcome?: string | null;
      instructions?: string;
    },
  ) => patch<{ task: AgentTask }>(`/api/tasks/${taskId}`, input),
  listTasks: (
    params: { assignee?: string; status?: AgentTaskStatus } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.assignee) search.set("assignee", params.assignee);
    if (params.status) search.set("status", params.status);
    return get<{ tasks: AgentTask[] }>(`/api/tasks?${search}`);
  },
};
