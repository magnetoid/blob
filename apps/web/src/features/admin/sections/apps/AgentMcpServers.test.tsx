// @vitest-environment happy-dom
/** An agent's own page says which MCP servers it may use, and where that is decided. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentMcpServers } from "./AgentMcpServers.tsx";
import { api, type McpServer } from "../../../../lib/api.ts";

const navigate = vi.fn();
vi.mock("../../../../lib/router.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/router.ts")>();
  return { ...actual, navigate: (...args: unknown[]) => navigate(...args) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate.mockReset();
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

  it("names the setting for a reader, and says so when a server is switched off", async () => {
    vi.spyOn(api.admin, "mcpServers").mockResolvedValue({
      servers: [server("s1", "GitHub", ["p1"], false)],
    });
    render(<AgentMcpServers pluginId="p1" agentName="Janus" />);
    expect(await screen.findByText(/\(some are switched off\)/)).toBeTruthy();
    expect(screen.getByText("Tools from MCP servers")).toBeTruthy();
  });

  it("says when it could not be read", async () => {
    vi.spyOn(api.admin, "mcpServers").mockRejectedValue(new Error("down"));
    render(<AgentMcpServers pluginId="p1" agentName="Janus" />);
    expect(
      await screen.findByText("Which MCP servers it may use could not be read."),
    ).toBeTruthy();
  });

  it("goes to the MCP servers page, where it is decided", async () => {
    vi.spyOn(api.admin, "mcpServers").mockResolvedValue({ servers: [] });
    render(<AgentMcpServers pluginId="p1" agentName="Janus" />);
    await screen.findByText(/Janus uses no MCP server/);
    fireEvent.click(screen.getByRole("button", { name: "MCP servers" }));
    expect(navigate).toHaveBeenCalledWith("/admin/mcp-servers");
  });
});
