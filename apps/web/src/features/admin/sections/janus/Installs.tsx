/** Where else on this server Janus is installed.
 *
 * One Janus container serves every workspace on the machine, so "is it working" has a
 * per-workspace answer that the workspace's own page cannot give. Only the server's
 * admin sees this: it is the one part of the page that names workspaces other than the
 * one being administered, and the overview it comes from answers nobody else.
 */

import type { JanusInstall } from "../../../../lib/api.ts";
import { Badge } from "../../../../components/ui/badge.tsx";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table.tsx";
import { Card, CardTable } from "../../../console/Card.tsx";

export function Installs({ installs }: { installs: JanusInstall[] }) {
  if (installs.length === 0) return null;
  return (
    <Card
      title="Every workspace on this server"
      description="The same Janus answers all of them. A workspace missing from this list has not been seeded yet — it is seeded on the next start of the app."
    >
      <CardTable label="Workspaces">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Workspace</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col" className="text-right">
              Channels
            </TableHead>
            <TableHead scope="col" className="text-right">
              Runs 7d
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {installs.map((install) => (
            <TableRow key={install.workspaceId}>
              <TableCell className="whitespace-normal">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{install.workspaceName}</span>
                  {install.isThisWorkspace && <Badge variant="outline">this one</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    install.status === "enabled"
                      ? "secondary"
                      : install.status === "failed"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {install.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{install.channelCount}</TableCell>
              <TableCell className="text-right tabular-nums">{install.runsLastWeek}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </CardTable>
    </Card>
  );
}
