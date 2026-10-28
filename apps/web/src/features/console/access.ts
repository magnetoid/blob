/** Who may open a console page, in the terms the server's gates use.
 *
 * Apart from `registry.ts` so the shell can gate a route without loading the catalogue:
 * the registry carries every row's label, description and keywords, and `Workspace.tsx`
 * sits in the first chunk, where three kilobytes of nav copy do not belong.
 */

import type { CurrentUser, UserRole } from '@blob/shared';
import type { ServerSection } from '../../lib/router.ts';

/**
 * Who may open a page — the server's own gate on the routes behind it, one per
 * dependency in `apps/api/src/blob_api/lib/auth.py`:
 *
 * * `admin` — `require_admin`: an admin or the owner of this workspace, which is
 *   everybody who can reach /admin at all. These rows carry no badge.
 * * `owner` — `require_owner`: this workspace's one owner.
 * * `instance` — `require_instance_admin`: whoever administers the server. That is a
 *   fact about the person — their address is in `instance_admins` — and not a role in
 *   this workspace. On a server with one workspace it is that workspace's owner; on a
 *   server with two it need not be, and an owner shown these rows would get a 403 from
 *   every one of them.
 *
 * A row's level is the gate its page cannot work without. A page that also reads an
 * instance-only route but carries on without it — Apps, Janus, Calls — stays `admin`,
 * and says inside itself what only the server's admin can see there.
 */
export type Access = 'admin' | 'owner' | 'instance';

/** Who is looking, in the terms the server's gates use. */
export interface Viewer {
  role: UserRole;
  isInstanceAdmin: boolean;
}

export function viewerOf(user: Pick<CurrentUser, 'role' | 'isInstanceAdmin'> | null): Viewer {
  return { role: user?.role ?? 'member', isInstanceAdmin: user?.isInstanceAdmin ?? false };
}

export function canOpen(access: Access, viewer: Viewer): boolean {
  switch (access) {
    case 'admin':
      return viewer.role === 'admin' || viewer.role === 'owner';
    case 'owner':
      return viewer.role === 'owner';
    case 'instance':
      // Not the role: the server's admin may be a plain admin of the workspace they are
      // in, and a workspace's owner may not run the server.
      return viewer.isInstanceAdmin;
  }
}

/**
 * The gate on each page of the server console. Here rather than only on its registry
 * rows because the shell gates the route by it before the console has loaded; the rows
 * read their level from this map, so the two cannot disagree.
 */
export const SERVER_ACCESS: Record<ServerSection, Access> = {
  // `/api/admin/health` is any admin's; the page asks for the server's log only when the
  // viewer is the server's administrator.
  health: 'admin',
  users: 'instance', // `/api/admin/instance/users`
  sso: 'instance', // `/api/admin/instance/sso` (ADR 0033)
  'app-policy': 'instance', // `/api/admin/instance/workspaces/{id}/policy`
  logs: 'instance', // `/api/admin/instance/logs`
};
