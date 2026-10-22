---
type: decision
status: accepted
tags: [adr, agents, chains, scheduling]
links:
  [
    0013-agent-chains-carry-human-authority,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
    0026-an-agent-may-follow-a-channel-and-hear-what-was-not-addressed-to-it,
  ]
rules: []
---

# ADR 0040: An agent may come back later, on the same person's say-so

## Context

An agent answered when it was asked, and then it was done. "Check whether the deploy
went out and tell me" had two endings: the agent guessed now, or somebody remembered to ask
again. The plan of 2026-10-18 (A1) wanted an agent able to schedule its own follow-up,
and ADR 0026 left it out with a reason: a follow-up posts later on the authority of the
person who asked, and the run that hears a followed channel deliberately has no approval
machinery to put that to anybody.

Two ways were open. A follow-up could be a *scheduled message* — a row of its own that, when
due, posts something which starts a run. But an agent's posts are its own (ADR 0022's
`post_message` posts as the agent), and a bot's message starts nothing without a parent
run, so the firing would have to be written in the person's name: words they never typed,
in the room, at a time they were not there. Or a follow-up could be *the same run, waiting*.
M2 already built a run that waits holding nothing (`ask_agent`, A2): it ends its round
`waiting`, keeps its tool exchange, and is carried on later as a resume on the same chain,
in the same place, on the same person's authority. Waiting for a time is that, with a clock
where the other agent's answer was.

## Decision

**An agent answering somebody may wait until a time it names and carry on then, in the
same conversation, for the same person. It is a run waiting, not a schedule.**

- **One tool, the agent's.** `schedule_followup(when, note)`: an ISO 8601 time with its
  offset, and a line saying what for. Not in the MCP catalogue — an assistant is a person
  (ADR 0016) and has its own ways to come back. Offered wherever `ask_agent` is: to a run
  somebody addressed whose agent has Blob's tools, read or write.
- **Never to a run nobody addressed.** A follow run (ADR 0026) may look, not act, and it
  may not wait either: nobody asked it anything to come back to.
- **Not put to the person.** It posts nothing now, and what it posts when it comes back is
  an answer in the conversation it was asked in — the one thing every run may do without
  approval. Anything it does then with Blob's tools asks exactly as it would have.
- **Seen and stoppable.** The run's card says when it comes back and what for, the Agents
  page and Home list it beside the runs at work, and Stop ends it like any waiting run.
- **Bounded.** At least a minute ahead and at most fourteen days; one wait at a time per
  run (a run that waits does nothing else); five per chain, so "come back tomorrow" cannot
  become every day for ever. A refused call is a tool result the agent reads, not a failure.
- **Asked again on waking.** Days can pass, so the resume first checks what a wait of a
  quarter hour never needed to: the person is still active, may still read the room, and
  may still command the agent, and agents are still on in the workspace. Any of those gone
  ends the run with that reason on its card; the agent is not called.
- **The same machinery.** The interrupt is `{kind: "come_back", comes_back: {until,
  note}}` beside the call and the exchange; `waiting_to_hear` wakes it when `until` passes
  and the chain's quarter-hour wall and the hop's grace — `ask_agent`'s nets — never touch
  it; `_hear` carries it on with the note as the call's result. The nightly sweep of old
  runs leaves a waiting run alone.

**Not built:** a recurring follow-up (a repeating scheduled message that mentions the agent
is how a team gets a run every morning, and it is visible as what it is), and waking on an
event — a task coming due, a channel created — which still has no person at its root.

## Consequences

- `jobs/agui_later.py` holds the rules: what a call may ask for, how many a chain has had,
  what the agent is told when it wakes, and whether it still may.
- `agent_runs.interrupt` carries the wait; the run view gains `comesBackAt` and
  `comesBackFor`, which the card, Home and the Agents page draw.
- `docs/apps.md` lists the tool for agent authors, so an agent learns of it from Blob and
  not from Janus's changelog.
