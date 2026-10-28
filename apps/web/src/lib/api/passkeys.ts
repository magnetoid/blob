/** `api.passkeys` — see `lib/api.ts` for the assembled client. */

import type {
  CurrentUser,
} from "@blob/shared";
import type { PasskeyChallenge } from "./auth.ts";
import { get, post, patch, put, del } from "./client.ts";

/** One of your passkeys (ADR 0032). */
export interface PasskeyRow {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  /** Synced by a password manager to your other devices, rather than held by one. */
  backedUp: boolean;
}

export const passkeys = {
  list: () =>
    get<{ passkeys: PasskeyRow[]; twoStep: boolean }>("/api/auth/passkeys"),
  /** The first half of adding one. Needs a recent sign-in. */
  options: () =>
    post<{ options: Record<string, unknown> }>("/api/auth/passkeys/options"),
  add: (credential: PublicKeyCredentialJSON, name?: string) =>
    post<PasskeyRow>("/api/auth/passkeys", { credential, name }),
  rename: (id: string, name: string) =>
    patch<{ ok: true }>(`/api/auth/passkeys/${id}`, { name }),
  remove: (id: string) =>
    del<{ credentialId: string }>(`/api/auth/passkeys/${id}`),
  setTwoStep: (on: boolean) => put<{ ok: true }>("/api/auth/two-step", { on }),
  signInOptions: () => post<PasskeyChallenge>("/api/auth/passkey/options"),
  signIn: (flowId: string, credential: PublicKeyCredentialJSON) =>
    post<{ user: CurrentUser }>("/api/auth/passkey/sign-in", {
      flowId,
      credential,
    }),
  secondStep: (flowId: string, credential: PublicKeyCredentialJSON) =>
    post<{ user: CurrentUser }>("/api/auth/two-step", { flowId, credential }),
  confirmOptions: () =>
    post<PasskeyChallenge>("/api/auth/reauth/passkey/options"),
  confirm: (flowId: string, credential: PublicKeyCredentialJSON) =>
    post<{ ok: true }>("/api/auth/reauth/passkey", { flowId, credential }),
};
