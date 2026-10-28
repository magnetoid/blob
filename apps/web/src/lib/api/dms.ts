/** `api.dms` — see `lib/api.ts` for the assembled client. */

import type {
  ChannelWithState,
} from "@blob/shared";
import { post } from "./client.ts";

export const dms = {
  open: (userIds: string[]) =>
    post<{ channel: ChannelWithState }>("/api/dms", { userIds }),
};
