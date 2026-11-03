/** Every account on the server.
 *
 * Not the same page as the workspace's Members list, and the difference is the point:
 * that one is "who is in here, and what may they do", with the controls to change it.
 * This one is "who exists on this machine at all", grouped by the workspace they belong
 * to. Roles are changed where a role means something, which is inside a workspace.
 *
 * Bots are shown rather than filtered out. An app's bot is a real user row — that is the
 * decision ADR 0005 rests on — and an instance operator counting accounts should see the
 * same rows the database has.
 */

import { useCallback, useMemo, useState } from "react";
import { api, type InstanceUser } from "../../../lib/api.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Input } from "../../../components/ui/input.tsx";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.tsx";
import { CardNotice, CardTable } from "../../console/Card.tsx";
import { useAdminData } from '../../console/hooks.ts';

export function AccountsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [query, setQuery] = useState("");

  const load = useCallback(() => api.admin.instanceUsers(), []);
  const { data } = useAdminData(load, [], onError, "Could not load accounts.");

  const users = useMemo(() => data?.users ?? [], [data]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.workspaceName.toLowerCase().includes(needle),
    );
  }, [users, query]);

  const humans = users.filter((u) => u.kind === "human").length;

  // A fragment: whoever frames this — the People page, or AdminConsole for the old
  // /admin/users URL — draws the card, and these are its children.
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Input
          className="sm:max-w-80"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an account"
          aria-label="Find an account"
        />
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          {users.length} {users.length === 1 ? "account" : "accounts"} — {humans}{" "}
          human, {users.length - humans} bot.
        </p>
      </div>

      {shown.length === 0 ? (
        <CardNotice>Nothing matched.</CardNotice>
      ) : (
        <CardTable label="Accounts">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Email</TableHead>
              <TableHead scope="col">Workspace</TableHead>
              <TableHead scope="col">Role</TableHead>
              <TableHead scope="col">State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((user: InstanceUser) => (
              <TableRow key={user.id}>
                {/* A name, an address and a workspace are data, so one long token wraps
                    inside its cell and the table scrolls sideways before it clips. */}
                <TableCell className="whitespace-normal wrap-anywhere">
                  {user.displayName}
                  {user.kind === "bot" && (
                    <>
                      {" "}
                      <Badge variant="secondary">App</Badge>
                    </>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal wrap-anywhere text-muted-foreground">
                  {user.email}
                </TableCell>
                <TableCell className="whitespace-normal wrap-anywhere">{user.workspaceName}</TableCell>
                <TableCell>{user.role}</TableCell>
                <TableCell className="text-muted-foreground">
                  {user.deactivated ? "Deactivated" : "Active"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </CardTable>
      )}
    </>
  );
}
