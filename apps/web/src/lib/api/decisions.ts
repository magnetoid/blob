/** `api.decisions` — see `lib/api.ts` for the assembled client. */

import type {
  Decision,
} from "@blob/shared";
import { get, post, patch } from "./client.ts";

// The decision log (M2 · A8): what conversations settled, read under each channel's
// membership. Recording is idempotent on `clientId`.
export const decisions = {
  list: (
    params: { channelId?: string; q?: string; revoked?: boolean; before?: string; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.channelId) query.set("channelId", params.channelId);
    if (params.q) query.set("q", params.q);
    if (params.revoked) query.set("revoked", "true");
    if (params.before) query.set("before", params.before);
    if (params.limit) query.set("limit", String(params.limit));
    const suffix = query.toString();
    return get<{ decisions: Decision[]; nextBefore?: string | null }>(
      `/api/decisions${suffix ? `?${suffix}` : ""}`,
    );
  },
  get: (id: string) => get<Decision>(`/api/decisions/${id}`),
  record: (
    channelId: string,
    input: { title: string; rationale?: string; messageId?: string; clientId: string },
  ) => post<Decision>(`/api/channels/${channelId}/decisions`, input),
  change: (id: string, input: { title?: string; rationale?: string }) =>
    patch<Decision>(`/api/decisions/${id}`, input),
  revoke: (id: string, revoked = true) =>
    post<Decision>(`/api/decisions/${id}/revoke`, { revoked }),
};
