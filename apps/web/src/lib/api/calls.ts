/** `api.calls` — see `lib/api.ts` for the assembled client. */

import type {
  Call,
  CallKind,
  CallsState,
  CallToken,
} from "@blob/shared";
import { get, post } from "./client.ts";

export const calls = {
  state: () => get<CallsState>("/api/calls"),
  start: (channelId: string, kind: CallKind) =>
    post<Call>("/api/calls", { channelId, kind }),
  token: (id: string) => post<CallToken>(`/api/calls/${id}/token`),
  // Unused today — not dead code. The client only ever leaves a call for itself
  // (`lib/calls.ts`'s `leaveCall`, a local disconnect that LiveKit's own webhook
  // reports back); this mirrors the real `POST /api/calls/:id/end`, which ends it for
  // everyone and is the starter's call to make, or an admin's, for whenever a control
  // for that exists.
  end: (id: string) => post<Call>(`/api/calls/${id}/end`),
};
