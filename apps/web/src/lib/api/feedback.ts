/** `api.feedback` — see `lib/api.ts` for the assembled client. */

import type {
  FeedbackTicket,
} from "@blob/shared";
import { get, post, patch, del } from "./client.ts";

export const feedback = {
  submit: (input: {
    kind: "bug" | "feedback" | "feature";
    title: string;
    body: string;
    environment: Record<string, string>;
    consoleLog: string;
    snapshot: string;
  }) => post<{ ticket: FeedbackTicket }>("/api/feedback", input),
  list: (status?: "open" | "closed") =>
    get<{ tickets: FeedbackTicket[] }>(
      `/api/admin/feedback${status ? `?status=${status}` : ""}`,
    ),
  setStatus: (id: string, status: "open" | "closed") =>
    patch<{ ticket: FeedbackTicket }>(`/api/admin/feedback/${id}`, {
      status,
    }),
  remove: (id: string) => del<{ ok: true }>(`/api/admin/feedback/${id}`),
  snapshotUrl: (id: string) => `/api/admin/feedback/${id}/snapshot`,
};
