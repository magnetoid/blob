---
type: decision
status: accepted
tags: [adr, agents, plugins, deployment]
links:
  [
    0005-bots-are-real-users,
    0013-agent-chains-carry-human-authority,
    0014-work-channels-and-sandboxed-artifacts,
    0015-summaries-cite-and-nudges-stay-private,
    0016-an-assistant-token-is-a-person,
    0017-an-agent-reads-what-its-room-could-read,
    0018-an-agent-is-the-workspaces-or-a-persons,
  ]
rules: []
---

# Blob ships no agent of its own; Janus is the workspace agent

## Context

From 2026-09-14 Blob seeded two agents into every workspace: the one it ran itself
(`plugins/builtin.py` — an AG-UI server that never left the process, answering on the
server's `LLM_*` key, with tools that ran on the asker's authority) and Janus
(`magnetoid/janus`, a service in the stack, seeded by `services/janus_agent.py`). Two
`@` names in every sidebar, two configurations to keep in step, and a built-in agent that
had only ever been a placeholder for the real platform.

## Decision

Marko, 2026-09-15: *"Remove agent Blob, that doesn't exist anymore. Janus is the primary
agent."*

Blob ships no agent of its own. Janus is the agent every workspace gets — seeded at
founding and reconciled at boot by `services/janus_agent.py`, in every public channel
from the moment a channel exists (`plugins.in_every_public_channel`), addressed by its DM
without a mention (`plugins.answers_dm_without_mention`). Where Janus is not running, a
workspace has no agent and the home view says so.

The built-in runtime is deleted, not switched off: `plugins/builtin.py`, the in-process
transport, the `builtin` runtime and the `trusted` install flag that admitted it, and the
asker-authority tools (`jobs/agui_admission.agent_tools`) that only it used. With those
tools gone, [[0017-an-agent-reads-what-its-room-could-read]] has no subject and is
superseded: `workspace_policies.agent_reads`, the room bound in `services/mcp.py` and
the console switch are removed with it. Its reasoning is kept for the day an external
agent is offered Blob's tools — `plugins/agui.build_run_input` sends an empty `tools`
list by design, so that day is a decision, not a drift.

`LLM_*` stays for the two callers that remain: the unread recap and thread summaries.
`lib/llm.py` is the smallest layer those two need — the tool-calling half had one caller.

## A DM is addressed to its agent — for the right agents

The built-in agent answered its DM without `@Blob`, and only it: widening that to "any
bot in a DM" would hand every installed third-party app a run for every line typed at
it, with no manifest opt-in. That reasoning stands. The rule now: the room is the address
for a *resident* agent (`answers_dm_without_mention`, set only by the seeder) and for a
person's own agent (`owner_user_id` is the one person in the room — [[0018-an-agent-is-the-workspaces-or-a-persons]],
"your agent answers you"). An app installed by hand needs a mention in its DM; its
author's contract is unchanged.

## What stays

[[0013-agent-chains-carry-human-authority]] — a person's message roots a chain and
authority flows down it; unchanged, it never depended on which agent answered.
[[0014-work-channels-and-sandboxed-artifacts]], [[0015-summaries-cite-and-nudges-stay-private]],
[[0016-an-assistant-token-is-a-person]] and [[0018-an-agent-is-the-workspaces-or-a-persons]]
are untouched.

## Consequences

* Every workspace's agent runs in its own process with its own model and key, configured
  on Janus's side (see the console design of the same date for how Blob reaches it).
* Old conversations show messages from a retired "Blob", like any uninstalled app's.
* A deployment that has not set `COMPOSE_PROFILES=janus` goes from one agent to none.
