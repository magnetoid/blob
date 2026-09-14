---
type: decision
status: accepted
tags: [adr, agents, plugins, ownership, privacy]
links:
  [
    0005-bots-are-real-users,
    0010-agents-deploy-as-containers,
    0011-agui-is-an-inbound-transport,
    0012-agents-may-dial-in,
    0013-agent-chains-carry-human-authority,
    0016-an-assistant-token-is-a-person,
    0017-an-agent-reads-what-its-room-could-read,
  ]
rules: []
---

# ADR 0018: An agent is the workspace's or a person's

## Context

Every earlier agent decision answers one of two questions. *How does it arrive and where
does it run* — [[0010-agents-deploy-as-containers]] (a Git repository becomes a
container), [[0011-agui-is-an-inbound-transport]] (Blob is the AG-UI client and the agent
is the server), [[0012-agents-may-dial-in]] (an agent with no address holds a socket).
And *what may it do* — [[0013-agent-chains-carry-human-authority]] (a run spends the
rooting person's authority), [[0017-an-agent-reads-what-its-room-could-read]] (and may
spend it only where it is answering).

None of them answers **whose agent it is**. The schema has answered it since migration
`0025_agent_ownership`: `plugins.owner_user_id` NULL means the workspace's, set means one
person's, and `agent_delegations` is how an owner lends theirs out. `services/my_agents.py`
reads that column on every request. But it was never written down, so the distinction is
discoverable only by reading a column definition — and it is the first thing somebody has
to know before adding anything to this surface. On 2026-09-14 both production workspaces
held only workspace agents, so the personal half has no live example to learn from either.

There is also a thing that looks like a third kind and is not, and telling them apart is
most of the value of writing this down.

## Decision

**1. There are exactly two kinds of agent in a workspace, and `plugins.owner_user_id` is
the whole of the difference.**

*The workspace's* (`owner_user_id IS NULL`). An admin installs it once and it is
everybody's: anyone may mention it, it appears in every member's Agents section, it spends
the workspace's budget, and an admin enables, disables and uninstalls it.

Two of them exist in production and they are **not** the same agent, which is worth
saying because the name invites the mistake. `Blob` (slug `blob-agent`, `runtime:
builtin`) is the agent this server runs itself, in-process, with no endpoint at all,
spending the server's own model key through `lib/llm.py`. `Janus` (slug `janus`,
`runtime: external`) is the agent from the `magnetoid/janus` repository, deployed
alongside the system at its own origin and reached over AG-UI, carrying its own model
configuration inside its own deployment — on 2026-09-14 `gpt-5.6-terra` while Blob's was
DeepSeek. A model outage on one says nothing about the other.

What makes both of them the workspace's is neither their runtime nor where they came
from: it is that an admin installed them for everyone.

*A person's* (`owner_user_id` set). One member brings their own assistant into the
workspace. It answers them. It is listed only for them, and every "mine" lookup answers
**404** for somebody else's agent — whose an agent is stays private, for the same reason a
private channel's existence does (`services/my_agents.py`). The owner lends it out
deliberately through `agent_delegations`: to a named person, optionally in one channel
only, revocably. A shared agent that took instructions from the whole room would not be a
personal one.

**2. How an agent arrives is a separate axis from whose it is, and the two must not be
conflated.** Container from a repository, AG-UI URL, dial-in socket, built-in — that is
deployment and transport, and it is settled by 0010, 0011 and 0012. Ownership is
orthogonal: the same Janus can be installed as the workspace's or as one person's, and
nothing about the way it connects decides which. Do not infer ownership from `runtime`,
and do not add a runtime to express ownership.

**3. An assistant reaching in over MCP is not a third kind of agent.** [[0016-an-assistant-token-is-a-person]]
is deliberate and stays: an `mcp_tokens` row resolves to a *user*, there is no bot, and the
caller **is** that person. It is not in the Agents section, it cannot be mentioned, it has
no budget of its own, and it inherits every removal its owner inherits.

The test that keeps the three apart is one question: **is there a `users` row with
`bot_plugin_id` set?** If yes, it is an agent in the workspace and it is one of the two
above — ask `owner_user_id` which. If instead there is a token that resolves to a person,
that is the person, with a tool open somewhere else.

**4. No machine rule.** Nothing here is a text pattern a `forbid_pattern` could catch;
what enforces it is the owner predicate in `services/my_agents.py`, the 404 it answers for
somebody else's agent, and the tests that pin both. A rule that cannot fail is worse than
none, because it reads as coverage.

## Consequences

- Anything that lists agents to a member filters on `owner_user_id IS NULL OR
  owner_user_id = :me`. `my_agents.available` is that query; new surfaces that offer
  agents — a picker, a work channel, a scheduled run — reuse it rather than writing their
  own, or somebody else's personal assistant becomes offerable and then refuses.
- The sidebar, the mention autocomplete and the Agents section show an agent only while it
  is installed **and** enabled, which is a separate question from ownership and is settled
  by `User.agentDisabled` and `deactivated`.
- A personal agent must never silently become the workspace's. One latent path could do
  it: `plugins.owner_user_id` is `ON DELETE SET NULL`, so hard-deleting a `users` row would
  turn that person's agent into everybody's. Nothing hard-deletes a user today —
  deactivation sets `deactivated_at` — so this is a trap rather than a bug. Whoever writes
  the first real user deletion takes the agent with the person, or changes the constraint;
  the one transition this ADR forbids is a private agent becoming public by accident.
- 0013 still decides what a run may do. Ownership decides who may start one; authority
  inside it is the rooting person's either way, which is why lending an agent to somebody
  does not lend them the owner's reach.
