---
type: decision
status: accepted
tags: [adr, agents, tools, authorization, agui, mcp]
links:
  [
    0011-agui-is-an-inbound-transport,
    0013-agent-chains-carry-human-authority,
    0016-an-assistant-token-is-a-person,
    0017-an-agent-reads-what-its-room-could-read,
    0018-an-agent-is-the-workspaces-or-a-persons,
    0019-blob-ships-no-agent-of-its-own,
  ]
rules: []
---

# ADR 0022: An agent may use Blob's tools — on the asker's authority, inside the room, and every write asks first

## Context

[[0019-blob-ships-no-agent-of-its-own]] left `RunAgentInput.tools` empty "by design, so
that day is a decision, not a drift". This is that day. An agent answering in a channel
can read the conversation it was asked in and nothing else: asked "what did #ops decide
last week?", "who owns the billing migration?", or "put that summary in #general", it
can only say it cannot see. That is a chatbot beside the team, not a member of it, and
it is the gap the review of 2026-10-05 put first.

Three ways an agent could reach the workspace were considered, and two already exist:

- **Its bot token and the `/api/v1/` API.** The bot's own reach — every public channel,
  and private ones it was invited to — whoever asked. That is the wrong authority for a
  question a *person* asked ([[0013-agent-chains-carry-human-authority]]), and Janus, the
  agent Blob seeds, holds no token at all.
- **The MCP endpoint, as a client** ([[0016-an-assistant-token-is-a-person]]). Right
  authority — a token is a person — but it would mean handing an agent a credential that
  *is* somebody, which outlives the run, has no room it is answering in, and has no way to
  stop and ask before it posts.
- **AG-UI's own tools.** `RunAgentInput.tools` lists tools the *client* executes. The
  agent calls one by streaming `TOOL_CALL_START`/`ARGS`/`END` and stopping; the client runs
  it and sends the result back as a `tool` message on the next run in the same thread.
  Every framework that speaks AG-UI already does this, nothing new is held by anyone, and
  Blob — the client ([[0011-agui-is-an-inbound-transport]]) — decides every call.

## Decision

**Blob offers its tools over AG-UI, and runs every call itself.**

- **One catalogue.** The tools are the MCP endpoint's — `list_channels`, `read_channel`,
  `read_thread`, `search_messages`, `list_people`, and `post_message` — with the same
  names, schemas and executors (`services/mcp_catalogue.py`, `services/mcp.py`). What a
  tool does, and who it is scoped to, has one definition whether an assistant or an
  agent asks.
- **On the asker's authority.** A call runs as the person the chain runs on — the same
  `initiated_by_user_id` that decided whether the agent could be asked at all — through
  the same `assert_channel_access` a browser tab meets. An agent never reaches what that
  person could not.
- **Inside the room.** [[0017-an-agent-reads-what-its-room-could-read]]'s rule returns
  with a subject: in a channel, the agent reads public channels and the room it was asked
  in, and nothing else; in its own DM with the person, their full reach, because there
  the room *is* the person. A private channel outside the room answers "there is no
  channel by that name" — the 404 rule, so its existence stays private. This is what stops
  "summarise #salaries" in #general, typed by someone who is in #salaries, from landing a
  private channel's contents in a public one — and it is the shape a prompt injection
  wants.
- **Every write asks first.** A call to `post_message` pauses the run. The card under the
  mention asks the person the run is on behalf of — "Janus wants to post in #general: …"
  — with Approve and Deny, minted by Blob ([[0013-agent-chains-carry-human-authority]]'s
  decision machinery, a second kind of question). Approved, the message is posted as the
  agent's bot — it is the agent speaking — where that bot is a member and the person may
  write; denied, the agent is told the person declined. Either way the run continues with
  the result. A write nobody answers expires with the day, as a decision does. A message
  posted this way never starts a hop.
- **Opt-in, per agent.** `plugins.tool_access` is `none` (the default), `read`, or
  `write` (which includes read, and where every write still asks). An admin chooses on
  the agent's page. Nothing an agent was doing yesterday changes until somebody decides.
- **Bounded.** At most eight rounds of tool calls in one run, and the run's wall clock
  covers all of them. A result is cut to what a model should read in one go. Every call is
  a line on the card, with its arguments.
- **Results are data.** A tool result reaches the agent as a `tool` message and nowhere
  else: it is never posted, never folded into instructions, and cannot start a run, a
  hop, or a write without a person's click.

## Consequences

- `McpCaller` carries a room again (`room_channel_id`), checked at every point a channel
  is reached, and the search statement takes an audience again. A person's own assistant
  over `/api/mcp` constructs no room and is untouched.
- The run job loops: stream, execute the calls the agent left, continue with their
  results, until the agent answers without one, stops to ask, or a bound ends it. The run
  row spans the rounds, so the budget, the card, Stop and the ledger see one run.
- `agent_runs.interrupt` gains a second kind, `tool_approval`, holding the pending call
  and the exchange so far; the resume executes or declines it and goes on. The answer
  route is the one decisions already use.
- Migration 0047 adds `plugins.tool_access`; the console's agent page gains the control.
- The tools are offered to an agent whatever AG-UI version it declared: `tools` has been
  part of `RunAgentInput` since before 1.0.
