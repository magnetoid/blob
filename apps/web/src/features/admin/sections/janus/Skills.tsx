/** What Janus knows how to do. Read-only, deliberately.
 *
 * Skills are files on Janus's own volume, installed the way Janus installs them. Blob
 * shows the list so "why did it answer like that" has somewhere to start, and offers no
 * control over it: a console that could add a skill would be Blob installing code on the
 * agent's machine, which is the line ADR 0007 draws.
 */

import { Card, CardNotice } from "../../../console/Card.tsx";
import type { JanusSkill } from "./config.ts";

export function Skills({ skills, error }: { skills: JanusSkill[]; error: string | null }) {
  return (
    <Card
      title="Skills"
      description="Installed on Janus itself, and the same for every workspace here. Adding or removing one is done where Janus runs."
      className="janus-part"
    >
      {error && <p className="error-text">{error}</p>}

      {skills.length === 0 ? (
        !error && <CardNotice>Janus has no skills installed.</CardNotice>
      ) : (
        <div className="console-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">What it is for</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.name}>
                  <td>
                    <div className="admin-row-title">{skill.name}</div>
                    {skill.category && (
                      <div className="admin-row-meta">{skill.category}</div>
                    )}
                  </td>
                  <td>{skill.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
