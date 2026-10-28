/** `api.themes` — see `lib/api.ts` for the assembled client. */

import type {
  Theme,
} from "@blob/shared";
import { get, put, del } from "./client.ts";

export const themes = {
  list: () =>
    get<{ themes: Theme[]; groups: Record<string, string[]> }>("/api/themes"),
  save: (input: {
    id?: string;
    name: string;
    mode: "light" | "dark";
    tokens: Record<string, string>;
    isEnabled?: boolean;
  }) => put<{ theme: Theme }>("/api/admin/themes", input),
  remove: (id: string) => del<{ ok: true }>(`/api/admin/themes/${id}`),
};
