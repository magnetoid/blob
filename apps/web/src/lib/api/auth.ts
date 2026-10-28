/** `api.auth` — see `lib/api.ts` for the assembled client. */

import type {
  CurrentUser,
} from "@blob/shared";
import { get, post, del } from "./client.ts";

export interface AuthSession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** How that browser signed in; null for sessions older than the record of it. */
  method: string | null;
  workspaceId: string | null;
  /** Which of your workspaces it is in: sessions are listed across all of them. */
  workspace: string | null;
}

/** One line of a person's own sign-in record. */
export interface AccountEvent {
  id: string;
  kind:
    | "signed_in"
    | "confirmed"
    | "failed"
    | "password_changed"
    | "signed_out_elsewhere"
    | "session_ended"
    | "passkey_added"
    | "passkey_removed"
    | "two_step_on"
    | "two_step_off"
    | "sso_linked"
    | "sso_unlinked";
  method: string | null;
  ip: string | null;
  userAgent: string | null;
  workspace: string | null;
  createdAt: string;
}

/** A challenge for `navigator.credentials.get`, and the flow id that spends it. */
export interface PasskeyChallenge {
  flowId: string;
  options: Record<string, unknown>;
}

/** A single sign-on provider, as a button shows it (ADR 0033). */
export interface SsoChoice {
  slug: string;
  name: string;
}

export interface ReauthState {
  /** The ways this person can confirm it is them. */
  methods: string[];
  /** Their linked single sign-on providers, each a way to confirm. */
  providers?: SsoChoice[];
  provenAt: string | null;
  windowMinutes: number;
}

export const auth = {
  state: () =>
    get<{ needsSetup: boolean; setupTokenRequired?: boolean; providers?: SsoChoice[] }>(
      "/api/auth/state",
    ),
  signup: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName?: string;
    inviteToken?: string;
    /** The server's setup token, from whoever founds the first workspace. */
    setupToken?: string;
  }) => post<{ user: CurrentUser }>("/api/auth/signup", input),
  /** `user` when that signed you in; `twoStep` instead when your passkey is asked for
   *  too, to answer at `passkeys.secondStep`. */
  login: (email: string, password: string) =>
    post<{ user: CurrentUser | null; twoStep: PasskeyChallenge | null }>(
      "/api/auth/login",
      { email, password },
    ),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  sessions: () => get<{ sessions: AuthSession[] }>("/api/auth/sessions"),
  endSession: (id: string) => del<{ ok: true }>(`/api/auth/sessions/${id}`),
  logoutOthers: () => post<{ ok: true }>("/api/auth/logout-others"),
  activity: () =>
    get<{ events: AccountEvent[]; keepDays: number }>("/api/auth/activity"),
  reauthState: () => get<ReauthState>("/api/auth/reauth"),
  reauth: (password: string) => post<{ ok: true }>("/api/auth/reauth", { password }),
  changePassword: (input: { currentPassword?: string; newPassword: string }) =>
    post<{ ok: true }>("/api/auth/password", input),
  invite: (token: string) =>
    get<{ email: string | null; workspace: string }>(`/api/invites/${token}`),
  createInvite: (input: {
    email?: string;
    role?: "member" | "admin" | "guest";
    expiresInDays?: number;
    /** A guest's channels — all they will see (ADR 0034). */
    channelIds?: string[];
  }) =>
    post<{ url: string; expiresAt: string; emailed: boolean | null }>(
      "/api/invites",
      input,
    ),
  forgotPassword: (email: string) =>
    post<{ ok: true; mailReachable: boolean }>("/api/auth/forgot-password", {
      email,
    }),
  /** `signedIn` is false for a person whose sign-in also asks for a passkey. */
  resetPassword: (token: string, password: string) =>
    post<{ ok: true; signedIn: boolean }>("/api/auth/reset-password", {
      token,
      password,
    }),
};
