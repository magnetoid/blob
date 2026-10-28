/** `api.assistants` — see `lib/api.ts` for the assembled client. */

import { get, post, del } from "./client.ts";

/** An agent that belongs to the signed-in member. */
export interface AssistantToken {
  id: string;
  name: string;
  /** Always contains "read"; "write" is the second, separate decision. */
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** When it stops working. Every connection ends (migration 0051). */
  expiresAt: string | null;
}

/** Connections an assistant uses to reach this workspace as you (ADR 0016). */
export const assistants = {
  list: () =>
    get<{ tokens: AssistantToken[]; url: string }>("/api/me/mcp-tokens"),
  create: (name: string, canWrite: boolean, lifetimeDays: 30 | 90 | 365 = 90) =>
    post<{ token: AssistantToken; secret: string; url: string }>(
      "/api/me/mcp-tokens",
      { name, canWrite, lifetimeDays },
    ),
  revoke: (tokenId: string) =>
    del<{ ok: true }>(`/api/me/mcp-tokens/${tokenId}`),
};
