---
type: decision
status: accepted
tags: [adr, agents, agui, authorization, privacy]
links:
  [
    0013-agent-chains-carry-human-authority,
    0017-an-agent-reads-what-its-room-could-read,
    0018-an-agent-is-the-workspaces-or-a-persons,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
    0023-a-task-handed-to-an-agent-is-a-message-from-the-person-who-handed-it,
  ]
rules: []
---

# ADR 0026: An agent may follow a channel and hear what was not addressed to it

## Context

An agent answered what it was asked — a mention, its DM, a task handed to it, a scheduled
message naming it — and nothing else. That was the right floor, and it is no longer the
whole market: Claude Tag's ambient mode follows chosen channels and flags what people
need; Slack's agents watch channels; Mattermost's run on channel activity. The plan of
2026-10-18 put "agents that work while you are away" first, and its first decision was
that an agent may hear a channel without being mentioned.

ADR 0023 refused the cheapest version of this on purpose: "any bot in a DM" answering
every line would change an installed app's contract without its author's consent. Every
rule below exists so that following does not do that, and does not make an agent a
second source of noise in a room that has people in it.

## Decision

**An admin may let an agent follow a channel. A person's message there then starts a run
for that agent, marked as not addressed to it.**

- **An admin's switch, per agent and channel.** `agent_follows` holds one row per pair;
  the agent's page in the console sets it. Only an agent that answers over AG-UI or a
  socket, only in a channel (never a DM or group DM), and only where its bot is already a
  member — following is not joining, and an agent that could not answer would be sent
  every line for nothing.
- **A person's message, on that person's authority.** Only a message that roots a chain
  (ADR 0013) — a person's own, never a bot's — is heard, so the run is on its author's
  authority, bounded by the room (ADR 0022), and an agent only its owner may command
  hears only its owner (ADR 0018). A message that mentions the agent, or is in its DM,
  starts one addressed run as before, never a second.
- **The run is told.** Its input carries a context item `addressed` that says, in words a
  model reads, that it was not mentioned and should answer only with something the people
  there need, or finish without a word. An addressed run's input is unchanged.
- **It may look, not act.** Blob's read tools only, whatever its access: no post through a
  tool, no question to another agent. Nobody asked it anything, so nothing it does may
  wait on a person's approval. The same holds for what the agent sends of its own accord,
  whatever its framework does: its own interrupt asks nobody anything (the question is
  dropped and the run ends as what it said), an artifact it emits is not published into a
  work channel, and a reply naming another agent starts no hop.
- **The room sees what it says, and nothing else.** No card, no typing, no run events in
  the channel. Its messages arrive as anyone's do. A run that said nothing appears in no
  list — not the channel's cards, not Home, not run history — only in the admin's run log,
  where `agent_runs.addressed = false` marks it.
- **Throttled, and closed when unsure.** A cooldown per agent and channel (two minutes)
  and a daily cap (forty) are kept in Redis with set-if-absent, so workers share one
  answer and two messages a moment apart cannot both pass. When Redis is away the guard
  fails *closed* — no follow runs — unlike the rate limiter, because the one thing
  following must never do is send an agent every line of a busy channel. Over its budget,
  a follow is dropped in silence rather than refused in the room; with agents switched
  off it is not heard at all.

**Not built:** event triggers (`channel.created`, `file.shared`) still have no person at
their root, and the reasons in ADR 0023 stand. An agent scheduling its own follow-up
would post as the person who asked later, which needs the approval machinery a follow
run deliberately lacks.

## Consequences

- Migration 0055 adds `agent_follows` and `agent_runs.addressed` (true for every existing
  run). `services/agent_follows.py` holds the rules for following; admission
  (`jobs/agui_admission.followers_for`, `may_follow_now`) the throttle; `_announce` in
  `jobs/agui_outcome.py` keeps every run event of an unaddressed run out of the room.
- `GET/PUT/DELETE /api/admin/plugins/{id}/follows[/{channel}]`, audited as
  `plugin.follow_set`.
- `messages.announce` queues the run job for a person's message in a followed channel
  (`agent_follows.is_followed`); before that, only a mention or an agent's DM did, and a
  test that calls the job directly does not cross that step.
- An agent that does not read the `addressed` item will answer every message it hears, at
  most once per cooldown. That is why following is opt-in per channel and why the console
  says so; an agent built for it — or the seeded agent, told through the same item — keeps
  quiet.
