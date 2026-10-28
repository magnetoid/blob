/** `api.activity` — see `lib/api.ts` for the assembled client. */

import type {
  Message,
} from "@blob/shared";
import { get } from "./client.ts";

/** What Activity is narrowed to. */
export type ActivityKind = "all" | "mention" | "reaction";

/** One thing that happened to you: somebody named you, or reacted to what you wrote. */
export interface ActivityItem {
  kind: "mention" | "reaction";
  at: string;
  actorId: string | null;
  emoji: string | null;
  message: Message;
}

export const activity = {
  list: (kind: ActivityKind = "all", cursor?: string) =>
    get<{ items: ActivityItem[]; nextCursor: string | null }>(
      `/api/activity?kind=${kind}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
    ),
};
