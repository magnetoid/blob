/** What Janus knows how to do. Read-only, deliberately.
 *
 * Skills are files on Janus's own volume, installed the way Janus installs them. Blob
 * shows the list so "why did it answer like that" has somewhere to start, and offers no
 * control over it: a console that could add a skill would be Blob installing code on the
 * agent's machine, which is the line ADR 0007 draws.
 */

import { Alert, AlertDescription } from "../../../../components/ui/alert.tsx";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table.tsx";
import { Card, CardNotice, CardTable } from "../../../console/Card.tsx";
import type { JanusSkill } from "./config.ts";

export function Skills({ skills, error }: { skills: JanusSkill[]; error: string | null }) {
  return (
    <Card
      title="Skills"
      description="Installed on Janus itself, and the same for every workspace here. Adding or removing one is done where Janus runs."
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="wrap-anywhere">{error}</AlertDescription>
        </Alert>
      )}

      {skills.length === 0 ? (
        !error && <CardNotice>Janus has no skills installed.</CardNotice>
      ) : (
        <CardTable label="Skills">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Skill</TableHead>
              <TableHead scope="col">What it is for</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills.map((skill) => (
              <TableRow key={skill.name}>
                <TableCell className="align-top whitespace-normal">
                  <div className="font-medium">{skill.name}</div>
                  {skill.category && (
                    <div className="text-xs text-muted-foreground">{skill.category}</div>
                  )}
                </TableCell>
                <TableCell className="align-top whitespace-normal">{skill.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </CardTable>
      )}
    </Card>
  );
}
