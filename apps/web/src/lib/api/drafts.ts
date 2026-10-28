/** `api.drafts` — see `lib/api.ts` for the assembled client. */

import { get, put } from "./client.ts";

/** One draft as the server keeps it (ADR 0037); `device` names the tab that saved it. */
export interface DraftSave {
  channelId: string;
  threadRootId: string | null;
  body: string;
  device: string;
}

/** Assistants that sign in instead of holding a pasted token (ADR 0029). */
/** Drafts that follow you (ADR 0037): yours alone. */
export const drafts = {
  list: () =>
    get<{
      drafts: Array<{
        channelId: string;
        threadRootId: string | null;
        body: string;
        updatedAt: string;
      }>;
    }>("/api/drafts"),
  save: (input: DraftSave) =>
    put<{ draft: { body: string; updatedAt: string } | null }>("/api/drafts", input),
  /** The same save, made to outlive the page: `pagehide` is the last word a tab gets. */
  saveOnUnload: (input: DraftSave) => {
    void fetch("/api/drafts", {
      method: "PUT",
      keepalive: true,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => undefined);
  },
};
