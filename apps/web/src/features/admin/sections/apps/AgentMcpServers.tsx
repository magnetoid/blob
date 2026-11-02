/** On an agent's page: the MCP servers it may use (ADR 0027), and the way to change that.
 *
 * Granting is decided on the MCP servers page, server by server, because that is where
 * the tools and their policies are — an admin choosing whether an agent may use GitHub
 * should see what GitHub's tools would do. This row says where things stand from the
 * agent's side, so nobody wonders why it can open issues.
 */

import { useCallback, useId } from "react";
import { api } from "../../../../lib/api.ts";
import { navigate } from "../../../../lib/router.ts";
import { useFetch } from "../../../../lib/useFetch.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { Field, FieldContent, FieldDescription, FieldTitle } from "../../../../components/ui/field.tsx";

export function AgentMcpServers({ pluginId, agentName }: { pluginId: string; agentName: string }) {
  const load = useCallback(
    async () =>
      (await api.admin.mcpServers()).servers.filter((server) => server.agentIds.includes(pluginId)),
    [pluginId],
  );
  const { data: granted, error } = useFetch(load, [load]);
  const hint = useId();

  const said =
    granted === null
      ? error
        ? "Which MCP servers it may use could not be read."
        : "Reading which servers it may use…"
      : granted.length === 0
        ? `${agentName} uses no MCP server. Connect one and switch it on for ${agentName} on the MCP servers page.`
        : `${agentName} may use the tools of ${granted.map((server) => server.name).join(", ")}${
            granted.some((server) => !server.enabled) ? " (some are switched off)" : ""
          }. Which calls wait for the person who asked is set tool by tool there.`;

  // Not one of the page's switches: nothing here is set from this row. It says where
  // things stand and goes to where they are changed.
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>Tools from MCP servers</FieldTitle>
        <FieldDescription id={hint}>{said}</FieldDescription>
      </FieldContent>
      <Button variant="outline" aria-describedby={hint} onClick={() => navigate("/admin/mcp-servers")}>
        MCP servers
      </Button>
    </Field>
  );
}
