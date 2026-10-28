/** `api.mail` — see `lib/api.ts` for the assembled client. */

import { get, post } from "./client.ts";

/** Whose away emails a link stops, and whether they are off now. */
export interface UnsubscribeInfo {
  email: string;
  workspace: string;
  off: boolean;
}

/** The link in an away email (ADR 0036): no session, the token is the authority. */
export const mail = {
  unsubscribeInfo: (token: string) =>
    get<UnsubscribeInfo>(`/api/mail/unsubscribe?t=${encodeURIComponent(token)}`),
  unsubscribe: (token: string) =>
    post<UnsubscribeInfo>(`/api/mail/unsubscribe?t=${encodeURIComponent(token)}`, {}),
};
