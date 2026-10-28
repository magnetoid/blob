/** `api.scheduled` — see `lib/api.ts` for the assembled client. */

import type {
  ScheduledMessage,
} from "@blob/shared";
import { get, del } from "./client.ts";

export const scheduled = {
  list: () => get<{ scheduled: ScheduledMessage[] }>("/api/scheduled"),
  cancel: (id: string) => del<{ ok: true }>(`/api/scheduled/${id}`),
};
