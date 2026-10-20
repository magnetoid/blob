// @vitest-environment happy-dom
/** An agent's own page says which MCP servers it may use, and where that is decided. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentMcpServers } from "./AgentMcpServers.tsx";
import { api, type McpServer } from "../../../../lib/api.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const server = (id: string, name: string, agentIds: string[], enabled = true) =>
  ({ id, name, agentIds, enabled }) as McpServer;

describe("the MCP servers an agent may use", () => {
  it("names the servers granted to it", async () => {
    vi.spyOn(api.admin, "mcpServers").mockResolvedValue({
      servers: [server("s1", "GitHub", ["p1"]), server("s2", "Linear", ["p2"])],
    });
    render(<AgentMcpServers pluginId="p1" agentName="Janus" />);
    expect(
      await screen.findByText(/Janus may use the tools of GitHub\./),
    ).toBeTruthy();
    expect(screen.queryByText(/Linear/)).toBeNull();
    expect(screen.getByRole("button", { name: "MCP servers" })).toBeTruthy();
  });

  it("says where to start when it may use none", async () => {
    vi.spyOn(api.admin, "mcpServers").mockResolvedValue({ servers: [] });
    render(<AgentMcpServers pluginId="p1" agentName="Janus" />);
    expect(await screen.findByText(/Janus uses no MCP server/)).toBeTruthy();
  });
});
