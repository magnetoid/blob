/** Where else on this server Janus is installed.
 *
 * One Janus container serves every workspace on the machine, so "is it working" has a
 * per-workspace answer that the workspace's own page cannot give. Only the server's
 * admin sees this: it is the one part of the page that names workspaces other than the
 * one being administered, and the overview it comes from answers nobody else.
 */

import type { JanusInstall } from "../../../../lib/api.ts";

export function Installs({ installs }: { installs: JanusInstall[] }) {
  if (installs.length === 0) return null;
  return (
    <div>
      <h3 className="section-label">Every workspace on this server</h3>
      <div className="pref-hint" style={{ marginBottom: 10 }}>
        The same Janus answers all of them. A workspace missing from this list has not
        been seeded yet — it is seeded on the next start of the app.
      </div>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Workspace</th>
              <th scope="col">Status</th>
              <th scope="col">Channels</th>
              <th scope="col">Runs 7d</th>
            </tr>
          </thead>
          <tbody>
            {installs.map((install) => (
              <tr key={install.workspaceId}>
                <td>
                  <div className="admin-row-title">{install.workspaceName}</div>
                  {install.isThisWorkspace && (
                    <div className="admin-row-meta">this one</div>
                  )}
                </td>
                <td>
                  <span className="role-pill" data-status={install.status}>
                    {install.status}
                  </span>
                </td>
                <td>{install.channelCount}</td>
                <td>{install.runsLastWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
