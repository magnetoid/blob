/** `api.later` — see `lib/api.ts` for the assembled client. */

import type {
  LaterItem,
  LaterState,
} from "@blob/shared";
import { get, patch } from "./client.ts";

export const later = {
  list: (state: LaterState = "in_progress") =>
    get<{ items: LaterItem[] }>(`/api/later?state=${state}`),
  update: (
    messageId: string,
    input: {
      state?: LaterState;
      remindAt?: string | null;
      note?: string | null;
    },
  ) => patch<{ ok: true }>(`/api/saved/${messageId}`, input),
};
