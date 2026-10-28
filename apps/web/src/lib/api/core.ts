/** The calls that sit directly on `api` — see `lib/api.ts` for the assembled client. */

import type {
  Bootstrap,
  Message,
  SyncResponse,
} from "@blob/shared";
import { get, post } from "./client.ts";

/** How search orders what it found. Slack's two: most relevant, or most recent. */
export type SearchSort = "relevance" | "newest";

/**
 * How the server read the query. Echoed so the box can show `from:@ana` even
 * when the leftover text is empty — modifiers-alone are a complete question.
 */
export type ParsedSearchQuery = {
  text: string;
  from: string | null;
  in: string | null;
  has: string | null;
  before: string | null;
  after: string | null;
  unresolved?: string[];
};

export const bootstrap = () => get<Bootstrap>("/api/bootstrap");

export const interact = (input: {
  messageId: string;
  actionId: string;
  value: string;
  /** The press's own id, so the same press arriving twice is one interaction. */
  clientActionId?: string;
}) => post<{ ok: true }>("/api/interactions", input);

export const search = (q: string, cursor?: string, sort: SearchSort = "relevance") =>
  get<{
    messages: Message[];
    total: number;
    sort: SearchSort;
    nextCursor: string | null;
    parsed: ParsedSearchQuery;
  }>(
    `/api/search?q=${encodeURIComponent(q)}` +
      (sort === "newest" ? "&sort=newest" : "") +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
  );

export const sync = (cursors: Record<string, string>) =>
  get<SyncResponse>(
    `/api/sync?cursors=${encodeURIComponent(JSON.stringify(cursors))}`,
  );
