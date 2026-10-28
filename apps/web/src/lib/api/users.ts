/** `api.users` — see `lib/api.ts` for the assembled client. */

import type {
  User,
} from "@blob/shared";
import { get } from "./client.ts";

export const users = {
  get: (id: string) => get<{ user: User }>(`/api/users/${id}`),
};
