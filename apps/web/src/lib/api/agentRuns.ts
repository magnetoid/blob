/** `api.agentRuns` — see `lib/api.ts` for the assembled client. */

import type {
  AgentRunView,
} from "@blob/shared";
import { get, post } from "./client.ts";

export const agentRuns = {
  forChannel: (channelId: string) =>
    get<{ runs: AgentRunView[] }>(`/api/channels/${channelId}/agent-runs`),
  mine: () => get<{ runs: AgentRunView[] }>("/api/agent-runs"),
  cancel: (runId: string) =>
    post<{ ok: true }>(`/api/agent-runs/${runId}/cancel`),
  /**
   * Answer the decision an interrupted run is waiting on — with the place of one of
   * the choices its view offers, or with words when it asked for words. Only its asker
   * may.
   */
  answer: (
    runId: string,
    answer: { choice: number } | { value: string },
    clientActionId?: string,
  ) =>
    post<{ ok: true }>(`/api/agent-runs/${runId}/answer`, {
      ...answer,
      clientActionId,
    }),
  /**
   * A conversation's runs or an agent's, newest first, a page at a time — an agent
   * named by its app or by the member it is.
   */
  history: (scope: {
    channelId?: string;
    pluginId?: string;
    agentUserId?: string;
    before?: string | null;
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    if (scope.channelId) search.set("channelId", scope.channelId);
    if (scope.pluginId) search.set("pluginId", scope.pluginId);
    if (scope.agentUserId) search.set("agentUserId", scope.agentUserId);
    if (scope.before) search.set("before", scope.before);
    if (scope.limit) search.set("limit", String(scope.limit));
    return get<{ runs: AgentRunView[]; nextBefore: string | null }>(
      `/api/agent-runs/history?${search}`,
    );
  },
};
