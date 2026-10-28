/** `api.oauth` — see `lib/api.ts` for the assembled client. */

import { get, post, del } from "./client.ts";

/** An app asking to connect as you (ADR 0029) — what the consent page asks about. */
export interface OAuthConsentRequest {
  id: string;
  clientName: string;
  /** The domain whose metadata document names the app; null when it registered itself,
   * which is only its own word for what it is. */
  vouchedBy: string | null;
  /** Where the answer is sent. */
  redirectHost: string;
  /** The answer goes to a program on this computer rather than to a website. */
  local: boolean;
  /** Always "read"; "write" when the app would like to post as well. */
  scopes: string[];
}

/** An app that signed in as you and keeps doing so until it is disconnected. */
export interface OAuthGrant {
  id: string;
  clientName: string;
  vouchedBy: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export const oauth = {
  /** Check the request the browser arrived at `/oauth/authorize` with. */
  authorize: (query: string) =>
    post<{ request: OAuthConsentRequest | null; redirectTo: string | null }>(
      "/api/oauth/authorize",
      { query },
    ),
  /** The person's answer; either way, where to send the browser next. */
  decide: (requestId: string, approve: boolean, write = false) =>
    post<{ redirectTo: string }>(`/api/oauth/requests/${requestId}`, {
      approve,
      write,
    }),
  grants: () =>
    get<{ grants: OAuthGrant[]; url: string }>("/api/oauth/grants"),
  disconnect: (grantId: string) =>
    del<{ ok: true }>(`/api/oauth/grants/${grantId}`),
};
