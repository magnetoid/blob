/** `api.groups` — see `lib/api.ts` for the assembled client. */

import { put } from "./client.ts";

export const groups = {
  setMuted: (groupId: string, muted: boolean) =>
    put<{ ok: true }>(`/api/groups/${groupId}/mute`, { muted }),
};
