// @vitest-environment happy-dom
/**
 * The MCP servers page (ADR 0027): connecting a server, choosing who may use it, and
 * deciding tool by tool whether a call waits for the person who asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { McpServersSection } from "./McpServersSection.tsx";
import {
  api,
  ApiError,
  type AdminPlugin,
  type McpServer,
} from "../../../lib/api.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GITHUB: McpServer = {
  id: "s1",
  name: "GitHub",
  slug: "github",
  url: "https://api.example.com/mcp",
  enabled: true,
  auth: "bearer",
  authHeader: null,
  era: "modern",
  protocolVersion: "2026-07-28",
  serverName: "github-mcp",
  serverVersion: "1.0",
  checkedAt: "2026-10-20T09:00:00Z",
  lastError: null,
  lastErrorAt: null,
  createdAt: "2026-10-20T09:00:00Z",
  tools: [
    {
      name: "search_issues",
      title: "Search issues",
      description: "Find issues by what they say.",
      readOnly: true,
      policy: "auto_everywhere",
    },
    {
      name: "create_issue",
      title: "Create issue",
      description: "Open a new issue.",
      readOnly: false,
      policy: "ask",
    },
  ],
  agentIds: ["p1"],
  skipped: [],
};

const agent = (id: string, name: string, extra: Partial<AdminPlugin> = {}) =>
  ({
    id,
    name,
    aguiUrl: `https://agents.example.com/${id}`,
    runtime: "external",
    ...extra,
  }) as AdminPlugin;

function loaded(servers: McpServer[] = [GITHUB]) {
  vi.spyOn(api.admin, "mcpServers").mockResolvedValue({ servers });
  vi.spyOn(api.admin, "plugins").mockResolvedValue({
    plugins: [
      agent("p1", "Janus"),
      agent("p2", "Scout"),
      // A webhook app is never offered tools, so it is not on the list.
      agent("p3", "Hooks", { aguiUrl: null, runtime: "external" }),
    ],
  } as never);
}

beforeEach(() => {
  loaded();
});

/** The connect form — each server's card has a form of its own with the same labels. */
function connectForm() {
  return within(
    screen
      .getByRole("heading", { name: "Connect a server" })
      .closest("section")!,
  );
}

describe("the MCP servers page", () => {
  it("shows each server, what it speaks, its tools and who may use them", async () => {
    render(<McpServersSection onError={vi.fn()} isOwner />);

    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByText(/Speaks MCP 2026-07-28\. 2 tools/)).toBeTruthy();
    expect(screen.getByText("reads only")).toBeTruthy();
    const ask = screen.getByRole("combobox", {
      name: "When an agent uses Create issue",
    });
    expect((ask as HTMLSelectElement).value).toBe("ask");
    expect(
      screen
        .getByRole("button", { name: "Janus may use GitHub" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Scout may use GitHub" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.queryByRole("button", { name: "Hooks may use GitHub" }),
    ).toBeNull();
  });

  it("says plainly when nothing is connected", async () => {
    loaded([]);
    render(<McpServersSection onError={vi.fn()} isOwner />);
    expect(await screen.findByText(/No servers yet/)).toBeTruthy();
  });

  it("decides a tool’s policy, and grants and revokes an agent", async () => {
    const set = vi
      .spyOn(api.admin, "setMcpToolPolicy")
      .mockResolvedValue(GITHUB);
    const grant = vi
      .spyOn(api.admin, "grantMcpServer")
      .mockResolvedValue(GITHUB);
    const revoke = vi
      .spyOn(api.admin, "revokeMcpServer")
      .mockResolvedValue(GITHUB);
    render(<McpServersSection onError={vi.fn()} isOwner />);

    const select = await screen.findByRole("combobox", {
      name: "When an agent uses Create issue",
    });
    fireEvent.change(select, { target: { value: "auto_in_dm" } });
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith("s1", "create_issue", "auto_in_dm"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Scout may use GitHub" }),
    );
    await waitFor(() => expect(grant).toHaveBeenCalledWith("s1", "p2"));
    fireEvent.click(
      screen.getByRole("button", { name: "Janus may use GitHub" }),
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("s1", "p1"));
  });

  it("connects a server with a token, and says what it left out", async () => {
    const add = vi.spyOn(api.admin, "addMcpServer").mockResolvedValue({
      ...GITHUB,
      id: "s2",
      name: "Docs",
      skipped: [
        "huge_tool: its input schema is larger than Blob hands a model",
      ],
    });
    render(<McpServersSection onError={vi.fn()} isOwner />);
    await screen.findByRole("heading", { name: "GitHub" });

    fireEvent.change(connectForm().getByLabelText("Name"), {
      target: { value: "Docs" },
    });
    fireEvent.change(connectForm().getByLabelText("Address"), {
      target: { value: "https://docs.example.com/mcp" },
    });
    fireEvent.change(connectForm().getByLabelText("Credential"), {
      target: { value: "bearer" },
    });
    fireEvent.change(connectForm().getByLabelText("Token"), {
      target: { value: "sekrit" },
    });
    loaded([GITHUB, { ...GITHUB, id: "s2", name: "Docs", slug: "docs" }]);
    fireEvent.click(connectForm().getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        name: "Docs",
        url: "https://docs.example.com/mcp",
        auth: { kind: "bearer", value: "sekrit" },
      }),
    );
    expect(
      await screen.findByText(
        /Left out, because Blob could not use them: huge_tool/,
      ),
    ).toBeTruthy();
  });

  it("puts the server’s refusal where the console shows errors", async () => {
    const onError = vi.fn();
    vi.spyOn(api.admin, "addMcpServer").mockRejectedValue(
      new ApiError(
        400,
        "mcp_unreachable",
        "The server answered 401: it refused Blob’s credentials.",
      ),
    );
    render(<McpServersSection onError={onError} isOwner />);
    await screen.findByRole("heading", { name: "GitHub" });
    fireEvent.change(connectForm().getByLabelText("Name"), {
      target: { value: "Docs" },
    });
    fireEvent.change(connectForm().getByLabelText("Address"), {
      target: { value: "https://docs.example.com/mcp" },
    });
    fireEvent.click(connectForm().getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        "The server answered 401: it refused Blob’s credentials.",
      ),
    );
  });

  it("disconnects a server only after asking", async () => {
    const remove = vi
      .spyOn(api.admin, "removeMcpServer")
      .mockResolvedValue({ ok: true });
    render(<McpServersSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(remove).not.toHaveBeenCalled();
    expect(await screen.findByText("Disconnect GitHub?")).toBeTruthy();
    const confirm = screen
      .getAllByRole("button", { name: "Disconnect" })
      .at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(remove).toHaveBeenCalledWith("s1"));
  });

  it("says when a server last failed, and when it is switched off", async () => {
    loaded([
      {
        ...GITHUB,
        enabled: false,
        lastError: "The server answered 503.",
        lastErrorAt: "2026-10-20T09:30:00Z",
      },
    ]);
    render(<McpServersSection onError={vi.fn()} isOwner />);
    expect(
      await screen.findByText(/Last failed .*: The server answered 503\./),
    ).toBeTruthy();
    expect(
      screen.getByText(/Switched off: no agent is offered its tools/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch on" })).toBeTruthy();
  });
});
