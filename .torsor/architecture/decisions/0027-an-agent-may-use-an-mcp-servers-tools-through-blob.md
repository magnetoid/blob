---
type: decision
status: accepted
tags: [adr, agents, agui, mcp, authorization, security]
links:
  [
    0007-user-content-is-data-never-code,
    0016-an-assistant-token-is-a-person,
    0018-an-agent-is-the-workspaces-or-a-persons,
    0019-blob-ships-no-agent-of-its-own,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
    0026-an-agent-may-follow-a-channel-and-hear-what-was-not-addressed-to-it,
  ]
rules: []
---

# ADR 0027: An agent may use an MCP server's tools, through Blob

## Context

An agent had Blob's own tools (ADR 0022) and whatever its own framework gave it. Anything
else outside Blob — the GitHub issue, the Linear ticket, the docs — was the agent
operator's business, wired up per agent, with the operator's credentials and none of the
workspace's rules. The 2026 bar is the other way round: Mattermost Agents connect MCP
servers with a policy per tool, Claude Tag and OpenAI's workspace agents reach the apps a
workspace connected. The plan of 2026-10-18 put this first in M2.

Two facts shaped it. Janus is a separate project (ADR 0019), so whatever agents get has to
arrive through the AG-UI contract every agent speaks, not through a Janus feature. And MCP
changed on 2026-07-28: the protocol became stateless — no `initialize`, no session, every
request carries its version in `_meta` and mirrors its method and tool into `Mcp-Method`
and `Mcp-Name` headers — while most servers in the wild still speak a 2025 revision.
Blob's own server (`routers/mcp.py`, ADR 0016) already answers both.

## Decision

**An admin may connect an MCP server to the workspace and let chosen agents use its tools.
Blob is the MCP client: it offers those tools to the agents beside its own, as
client-executed AG-UI tools, and makes every call itself.**

- **Blob calls; the agent asks.** The agent sees a tool in `RunAgentInput.tools` and calls
  it like Blob's own; Blob runs the call and hands back a `tool` message. The agent never
  holds the server's address or credential — an agent at another address cannot be
  trusted with the workspace's GitHub token — and every call passes through the one run
  loop where Blob's tools are counted, traced, drawn on the card and, when needed, put to
  a person.
- **The workspace's credential, the asker's authority to use it.** A server is connected
  with no credential, a bearer token, or one named header that Blob does not set itself.
  It is kept in `mcp_server_secrets`, apart from the row as an app's signing secret is,
  read only where a request is made and never returned. Granting a server to an agent
  lends its tools to everyone who may command that agent — for a person's own agent, its
  owner and their borrowers (ADR 0018) — and the console says so beside the switch.
- **Each tool has a policy, and the admin sets it: `off`, `ask`, `auto_in_dm`,
  `auto_everywhere`.** The values `plugins.write_approval` has, meaning the same: when a
  call waits for the person who asked. A tool the server calls read-only
  (`readOnlyHint`) starts at `auto_everywhere`, anything else at `ask`. The spec has a
  client treat annotations as untrusted, and here they set the default an admin sees and
  nothing more. A refresh keeps a tool's policy; a new tool starts at its default.
- **Ask means the person sees what would be sent.** An `ask` call stops the run as a post
  does (ADR 0022). The question names the tool, the server, and every argument, a line
  each, and only the Approve of the person who asked sends it — the spec's "show tool
  inputs to the user before calling the server". Resumed, the call is found again by
  server and tool name as the run is offered them now: a server removed, switched off or
  no longer granted, or a tool turned off, while the question waited is not called.
- **Not in a run nobody addressed.** A follow run (ADR 0026) is offered no server's
  tools. A call goes out on the workspace's credential, and a message nobody addressed to
  the agent is the one case where no person chose to involve it at all.
- **The network guard at every request.** An https address that resolves outside the
  server's own network, checked when the server is added and again before every request;
  a private address only where `may_use_private_endpoints` allows it, the switch apps
  use. No redirect is followed. Every answer is read against a byte budget and a deadline
  (`MCP_CALL_TIMEOUT_SEC`, never past the run's own wall clock).
- **Blob speaks 2026-07-28, and falls back.** A modern request carries
  `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, the `_meta` version, client info and
  capabilities, and an `Mcp-Param-*` header for each argument a tool marks with
  `x-mcp-header` — which a client must support; a tool whose marks break the rules is left
  out, as the spec says. Which era a server speaks is found the transport spec's way:
  `server/discover` first, and a refusal with no modern error in it means legacy, so Blob
  initialises — asking for 2025-11-25 and accepting 2025-06-18 or 2025-03-26 — keeps the
  session for the life of the process, and opens another when the server answers 404.
  The era is stored on the row; a call that finds it changed probes once and writes back
  what it found. Blob declares no client capabilities: sampling, elicitation and roots are
  deprecated or folded into multi-round-trip requests in this revision, so a tool that
  answers `input_required` is an error the agent reads.
- **Listed once, offered from Blob's copy.** Tools are listed when an admin connects or
  refreshes a server, checked (a name, a schema of at most 32 KB, a description cut to
  2,000 characters), and stored in the server's order, at most 128. A run reads them from
  the database: it never waits on `tools/list`, and the same list in the same order keeps
  a model's prompt cache warm. One run is offered at most 64 of them and 256 KB of their
  schemas, without the `x-mcp-header` marks, which are transport detail a strict provider
  would refuse.
- **Names that cannot collide.** `<slug>__<tool>`: the slug made once from the server's
  name, in letters, digits and hyphens and never an underscore; the tool's name cut to
  `[A-Za-z0-9_-]` and 64 characters in all, with a short hash where cutting would collide.
  None of Blob's own tool names contains `__`.
- **What comes back is data** (ADR 0007). Text in order; structured content as JSON when
  there is no text; an image or audio as a line saying it was not passed on; a link as
  its address — capped at 24,000 characters, like Blob's own. `isError` and a JSON-RPC
  refusal are errors the agent can read and correct; a server that could not be reached
  is an error too, and a line on the server's row for the admin who connected it.
- **Seen.** On the run card, with the server's name beside the tool; counted in
  `blob_mcp_server_calls_total{server, tool, outcome}`; traced as `execute_tool` with
  `blob.mcp.server`, the client's request beneath it carrying the trace context; audited
  as `mcp_server.added`, `changed`, `removed`, `tool_policy` and `granted`.

**Not built:**

- **OAuth.** A server that wants an OAuth sign-in — the hosted Notion, Atlassian and Sentry
  servers among them — is refused, with a message saying so. There are two kinds to
  build: an admin's sign-in for the workspace (authorization code with PKCE and a client
  ID metadata document, as the 2026-07-28 authorization spec prefers over dynamic
  registration), and each person's own, which is the one that would let a write be made
  as the person rather than as the workspace. They are the next slice on this surface.
- The OAuth client-credentials extension, still a draft that no major client implements.
- A server's resources and prompts, `subscriptions/listen`, the tasks extension, MCP Apps.
- stdio servers: Blob starts no process on an admin's say-so (ADR 0007).
- Credentials encrypted at rest. They are kept as `plugin_secrets` are; a key outside the
  database is for both at once, and is security work already on the list.
- The window between resolving a name and connecting to it, where a rebinding DNS answer
  could slip through, is the one every outbound call here has, and closes for all of them
  together (the 2026-10 security review's phase 2).

## Consequences

- Migration 0056 adds `mcp_servers`, `mcp_server_secrets`, `mcp_server_tools` and
  `agent_mcp_servers`. Nothing existing changes until an admin connects a server.
- `plugins/mcp_client.py` is the client, `services/mcp_servers.py` the rules and storage,
  `routers/mcp_servers.py` the console's API (`/api/admin/mcp-servers`, every route
  `require_admin`). In the run loop, `jobs/agui_outcome._tools_for` reads what a run is
  offered, `_run_calls` runs or asks, and `_approved_call` settles an answer;
  `jobs/agui_tools` holds `PreparedOutside` and `run_outside`.
- An agent author sees more tools, named `<server>__<tool>`, answered with the same
  `tool` messages as Blob's own; `docs/apps.md` says so. Janus needs no release.
- The console has an MCP servers page, and an agent's page says which servers it may use.
- An approval's question keeps its line breaks on screen (`white-space: pre-line`): a post
  approval quoted the post a line at a time and had been drawn as one run of text.
- Settings: `MCP_CALL_TIMEOUT_SEC` (60) and `MCP_LIST_TIMEOUT_SEC` (20).
