/** `api.sso` — see `lib/api.ts` for the assembled client. */

import type { SsoChoice } from "./auth.ts";
import { get, post, del } from "./client.ts";

export interface SsoIdentity {
  providerId: string;
  slug: string;
  name: string;
  linkedAt: string | null;
  lastUsedAt: string | null;
}

export const sso = {
  /** Start a round trip through a provider; the answer is where to send the browser. */
  begin: (input: {
    provider: string;
    intent: "sign_in" | "confirm" | "link";
    next?: string;
    invite?: string;
  }) => post<{ url: string }>("/api/auth/sso/begin", input),
  identities: () =>
    get<{ identities: SsoIdentity[]; available: SsoChoice[] }>(
      "/api/auth/sso/identities",
    ),
  unlink: (providerId: string) =>
    del<{ ok: true }>(`/api/auth/sso/identities/${providerId}`),
};
