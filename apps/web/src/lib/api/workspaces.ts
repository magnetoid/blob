/** `api.workspaces` — see `lib/api.ts` for the assembled client. */

import { get, post } from "./client.ts";

/** One workspace this person can reach, and who they are inside it. */
export interface WorkspaceMembership {
  id: string;
  name: string;
  slug: string;
  role: "member" | "admin" | "owner" | "guest";
  current: boolean;
}

export const workspaces = {
  /** Every workspace this address has a live account in. */
  mine: () =>
    get<{ workspaces: WorkspaceMembership[] }>("/api/workspaces/mine"),
  /**
   * Move this browser to the account held in another workspace.
   *
   * The session cookie is swapped server-side, so everything cached from the old one
   * is now wrong — the caller reloads rather than trying to reconcile two workspaces
   * of state in a store built for one.
   */
  switch: (id: string) =>
    post<{ workspaceId: string; userId: string }>(
      `/api/workspaces/${id}/switch`,
    ),
};
