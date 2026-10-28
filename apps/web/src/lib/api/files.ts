/** `api.files` — see `lib/api.ts` for the assembled client. */

import type {
  FileEntry,
} from "@blob/shared";
import { get, requestText } from "./client.ts";

export const files = {
  list: (
    query: {
      channelId?: string;
      kind?: "all" | "image" | "file" | "voice";
      cursor?: string;
      /** Filename contains, case-insensitive. ⌘K's Files section and /search?scope=files. */
      q?: string;
      /** Ask for one more than you will show, and a row came back means "there is more". */
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.channelId) params.set("channelId", query.channelId);
    if (query.kind && query.kind !== "all") params.set("kind", query.kind);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.q) params.set("q", query.q);
    if (query.limit) params.set("limit", String(query.limit));
    const suffix = params.size ? `?${params}` : "";
    return get<{ items: FileEntry[]; nextCursor: string | null }>(`/api/attachments${suffix}`);
  },
  /** A file's words, for the side panel. The server sends every kind of text as inert
   *  `text/plain`; refuses with `no_preview` or `preview_too_large`. */
  previewText: (attachmentId: string, signal?: AbortSignal) =>
    requestText(`/api/attachments/${attachmentId}/preview`, signal),
};
