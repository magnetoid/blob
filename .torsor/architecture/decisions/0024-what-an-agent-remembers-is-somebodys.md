---
type: decision
status: accepted
tags: [adr, agents, memory, privacy, ownership]
links:
  [
    0011-agui-is-an-inbound-transport,
    0017-an-agent-reads-what-its-room-could-read,
    0018-an-agent-is-the-workspaces-or-a-persons,
  ]
rules: []
---

# ADR 0024: What an agent remembers is somebody's — the conversation's, or one person's

## Context

Since migration 0027 an agent's AG-UI shared state is kept past the run, per (agent,
conversation), and handed to its next run there. For the workspace's agent that is the
right key: the conversation is the subject, and anyone's run in it may use what the agent
learned there.

For an agent somebody owns ([[0018-an-agent-is-the-workspaces-or-a-persons]]) it was
wrong. Lent to a colleague, the agent was handed whatever it remembered of its owner's
work in that conversation, and the colleague's run wrote over it. Phase 0 of the
2026-10-05 review closed the leak the blunt way — a borrowed run went without memory at
all — and left the key to this decision. Nobody could see a memory, clear one, or expect
one to end, and a deleted channel left its agents' memories behind, because the key was a
channel's id or a thread root's and could reference neither.

## Decision

**A memory belongs to the conversation for the workspace's agent, and to one person for an
agent somebody owns.**

- `agent_state.person_id` is NULL for the conversation's memory and a person for theirs,
  and the key is (agent, conversation, person) with a NULL person counted once. An owned
  agent's run on someone's behalf — its owner's, or a borrower's — reads and writes that
  person's own memory. A loan lends the agent, not what it knows.
- **Seen and cleared by whoever it belongs to.** A person sees what agents remember of
  their own conversations with them in Settings, and clears any of it. An admin sees an
  agent's conversation memories on its page — only in conversations they can see, since a
  memory is made of what was said in the room — and may clear one, or all of them,
  including rooms they are not in, which reveals nothing. A person's own memory is never
  shown to an admin.
- **It ends.** A memory nobody has written for 90 days goes in the nightly sweep, and a
  deleted channel takes its memories with it (`agent_state.channel_id`, a real foreign
  key at last).

## Consequences

- Migration 0050 reshapes `agent_state`: a surrogate `id`, `channel_id` backfilled from
  the key and cascading, `person_id` cascading, and a unique index `NULLS NOT DISTINCT`
  (PostgreSQL 15 and later) that the upsert's `ON CONFLICT` infers.
- `Listener.memory_of(person)` replaces `remembers_for`: there is no longer a run that
  goes without memory, only a question of whose.
- Loans are listed and ended in Settings beside the agent, as `/allow` and `/disallow`
  make and end them in a channel.

## Addendum (2026-10-20, M2 · A8): notes

An agent may now also keep **notes** — sentences it chose to remember, through Blob's
`remember`, `recall` and `forget` tools — in `agent_notes` (migration 0058). They follow this
decision exactly: keyed by (agent, conversation, person) with a NULL person for the
workspace's agent; read, reworded and removed by whoever they belong to — a person their
own in Settings, an admin a conversation's on the agent's page, in rooms they can see and
never a person's own; and ended by the nightly sweep ninety days after the last note in a
conversation, a deleted channel, agent or person taking theirs with it. A run is handed its
newest notes as a `notes` context item. The notes tools come with read access or more,
change nothing anybody else reads and so are never asked about, and are not offered in a
run nobody addressed (ADR 0026).
