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
import '../../../test/overlayChunk.ts';

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
      .closest('[data-slot="card"]')!,
  );
}

/** One server's card, found by the heading that names it. */
function serverCard(name: string) {
  return within(
    screen.getByRole("heading", { name }).closest('[data-slot="card"]')!,
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
      screen.getByRole("switch", { name: "Janus may use GitHub", checked: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Scout may use GitHub", checked: false }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("switch", { name: "Hooks may use GitHub" }),
    ).toBeNull();
  });

  it("lists the agents and the tools as lists, named for their server", async () => {
    render(<McpServersSection onError={vi.fn()} isOwner />);
    await screen.findByRole("heading", { name: "GitHub" });

    const agents = serverCard("GitHub").getByRole("list", {
      name: "Agents that may use GitHub",
    });
    expect(within(agents).getAllByRole("listitem")).toHaveLength(2);
    const tools = serverCard("GitHub").getByRole("list", { name: "Tools of GitHub" });
    expect(within(tools).getAllByRole("listitem")).toHaveLength(2);
    // The headings run on from the server's own: the page's h1, the card's h2, then these.
    expect(
      serverCard("GitHub")
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Agents that may use it", "Tools"]);
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

    fireEvent.click(screen.getByRole("switch", { name: "Scout may use GitHub" }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith("s1", "p2"));
    fireEvent.click(screen.getByRole("switch", { name: "Janus may use GitHub" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("s1", "p1"));
  });

  it("connects a server with a token, says what it left out, and forgets the token", async () => {
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

    fireEvent.change(connectForm().getByRole("textbox", { name: "Name" }), {
      target: { value: "Docs" },
    });
    fireEvent.change(connectForm().getByRole("textbox", { name: "Address" }), {
      target: { value: "https://docs.example.com/mcp" },
    });
    fireEvent.change(connectForm().getByRole("combobox", { name: "Credential" }), {
      target: { value: "bearer" },
    });
    // The token is typed into a password field, which nothing echoes back.
    const token = connectForm().getByLabelText("Token") as HTMLInputElement;
    expect(token.type).toBe("password");
    expect(token.autocomplete).toBe("off");
    fireEvent.change(token, { target: { value: "sekrit" } });
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
    // The form is back to where it began: no token field, no token anywhere on the page.
    expect(connectForm().queryByLabelText("Token")).toBeNull();
    expect(
      (connectForm().getByRole("combobox", { name: "Credential" }) as HTMLSelectElement).value,
    ).toBe("none");
    expect(document.body.innerHTML).not.toContain("sekrit");
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
    fireEvent.change(connectForm().getByRole("textbox", { name: "Name" }), {
      target: { value: "Docs" },
    });
    fireEvent.change(connectForm().getByRole("textbox", { name: "Address" }), {
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
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect GitHub" }));
    expect(remove).not.toHaveBeenCalled();
    expect(await screen.findByText("Disconnect GitHub?")).toBeTruthy();
    // The dialog's own button is the one that says only the verb.
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("s1"));
  });

  it("names a server in each of its buttons when there are several", async () => {
    loaded([GITHUB, { ...GITHUB, id: "s2", name: "Docs", slug: "docs", agentIds: [] }]);
    render(<McpServersSection onError={vi.fn()} isOwner />);
    await screen.findByRole("heading", { name: "Docs" });

    for (const name of ["GitHub", "Docs"]) {
      const card = serverCard(name);
      expect(card.getByRole("button", { name: `Refresh tools of ${name}` })).toBeTruthy();
      expect(card.getByRole("button", { name: `Switch off ${name}` })).toBeTruthy();
      expect(card.getByRole("button", { name: `Disconnect ${name}` })).toBeTruthy();
    }
    // And the agents' switches are the card's own.
    expect(
      serverCard("Docs").getByRole("switch", { name: "Janus may use Docs", checked: false }),
    ).toBeTruthy();
  });

  it("switches a server off and on from its header", async () => {
    const change = vi
      .spyOn(api.admin, "changeMcpServer")
      .mockResolvedValue({ ...GITHUB, enabled: false });
    render(<McpServersSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch off GitHub" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith("s1", { enabled: false }));
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
    const failed = await screen.findByText(/Last failed .*: The server answered 503\./);
    // Said without interrupting: it is the state the page opened on, not something that just
    // happened.
    expect(failed.closest('[role="status"]')).toBeTruthy();
    expect(
      screen.getByText(/Switched off: no agent is offered its tools/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch on GitHub" })).toBeTruthy();
  });

  it("greys the title of a server that is switched off, and only that one", async () => {
    loaded([GITHUB, { ...GITHUB, id: "s2", name: "Docs", slug: "docs", enabled: false }]);
    render(<McpServersSection onError={vi.fn()} isOwner />);
    await screen.findByRole("heading", { name: "Docs" });

    // happy-dom draws no CSS, so this is the class that carries the rule: the card says it
    // is off (`data-enabled`), and a title inside a card that says so is muted. The stylesheet
    // rule that did this keyed on a class the card's title no longer has.
    const off = screen.getByRole("heading", { name: "Docs" }).closest('[data-slot="card"]')!;
    const on = screen.getByRole("heading", { name: "GitHub" }).closest('[data-slot="card"]')!;
    const muted = "data-[enabled=false]:**:data-[slot=card-title]:text-muted-foreground";
    expect(off.getAttribute("data-enabled")).toBe("false");
    expect(off.className).toContain(muted);
    expect(on.getAttribute("data-enabled")).toBe("true");
    // Both cards carry the rule; only the one that is off has the attribute it waits for.
    expect(on.className).toContain(muted);
  });

  it("opens the form that changes a server, and says whether it is open", async () => {
    const change = vi.spyOn(api.admin, "changeMcpServer").mockResolvedValue(GITHUB);
    render(<McpServersSection onError={vi.fn()} isOwner />);
    await screen.findByRole("heading", { name: "GitHub" });

    const open = serverCard("GitHub").getByRole("button", {
      name: /Change its name, address or credential/,
    });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.getAttribute("aria-controls")).toBeNull();
    // Closed, there is no second form with the same labels to find.
    expect(serverCard("GitHub").queryByRole("textbox", { name: "Name" })).toBeNull();

    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(open.getAttribute("aria-controls")!)!;
    expect(within(panel).getByRole("textbox", { name: "Address" })).toBeTruthy();

    // Keeping the credential is the default, and a rename sends only the rename.
    expect(
      (within(panel).getByRole("combobox", { name: "Credential" }) as HTMLSelectElement).value,
    ).toBe("keep");
    fireEvent.change(within(panel).getByRole("textbox", { name: "Name" }), {
      target: { value: "GitHub (work)" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith("s1", { name: "GitHub (work)" }));

    // Saved: it closes, and focus is back on the button that opened it.
    await waitFor(() => expect(open.getAttribute("aria-expanded")).toBe("false"));
    expect(document.activeElement).toBe(open);
  });
});
