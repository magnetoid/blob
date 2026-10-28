/** `api.me` — see `lib/api.ts` for the assembled client. */

import type {
  CurrentUser,
  UserPrefs,
} from "@blob/shared";
import { get, post, patch, del } from "./client.ts";

/** An export, asked for or built (M3 · B4). */
export interface ExportEntry {
  id: string;
  scope: "workspace" | "personal";
  status: "pending" | "running" | "done" | "failed";
  bytes: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  requestedByName: string;
  /** Blob's own link, which checks who is asking; present once it is built. */
  downloadUrl: string | null;
}

export const me = {
  update: (input: Record<string, unknown>) =>
    patch<{ user: CurrentUser }>("/api/me", input),
  prefs: (input: Partial<UserPrefs>) =>
    patch<{ prefs: UserPrefs }>("/api/me/prefs", input),
  /** Your own exports — everything you are in (M3 · B4). */
  exports: () => get<{ exports: ExportEntry[] }>("/api/me/exports"),
  startExport: () => post<{ exports: ExportEntry[] }>("/api/me/exports", {}),
  pushPublicKey: () => get<{ key: string | null }>("/api/me/push-public-key"),
  subscribePush: (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) => post<{ ok: true }>("/api/me/push-subscription", subscription),
  unsubscribePush: (endpoint: string) =>
    del<{ ok: true }>("/api/me/push-subscription", { endpoint }),
  pushTest: () =>
    post<{ ok: true; sent: number; stale: number; failed: number }>(
      "/api/me/push-test",
    ),
};
