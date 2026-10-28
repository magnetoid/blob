/** `api.clientErrors` — see `lib/api.ts` for the assembled client. */

import { post } from "./client.ts";

/** A fault the client threw, for the workspace's admins (lib/clientErrors.ts). */
export const clientErrors = {
  report: (input: {
    message: string;
    stack: string | null;
    path: string;
    release: string | null;
  }) => post<{ ok: true }>("/api/client-errors", input),
};
