---
type: decision
status: accepted
tags: [adr, product, agents, privacy]
links:
  [
    0003-hand-tuned-sql-stays-sql,
    0013-agent-chains-carry-human-authority,
    0016-an-assistant-token-is-a-person,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
  ]
rules: []
---

# ADR 0028: A decision is a person's; an agent may only propose one

## Context

"A thread that reaches a decision leaves a decision behind" is one of Blob's principles,
and until M2 nothing did: a thread's summary could say what was settled, but only until
the next summary rewrote it. Teams in 2026 keep decision logs, and the ones that work
capture a decision where it was made, have a person approve it, and link it back to the
conversation — every product that tried to let an AI write the log unattended learned that
"who decided" stops being true.

## Decision

**A decision is a row of its own, rooted in the message it was settled in and read under
that message's channel. A person records it; an agent may only propose it.**

- **Rooted, and as private as its conversation.** `decisions` holds the channel, the source
  message (optional), the thread, what was decided in one line, and why. Listing joins
  `channel_members` as search does, so a private channel's decisions are listed only to its
  members and answer 404 to anybody else, as the channel does. An agent reading the log is
  held to its room (ADR 0022).
- **Recorded by a person**, from a message's menu, a thread summary's decision, or
  `/decision`, which posts the words as the person's message and records the decision on
  it in one transaction. A person's assistant over `/api/mcp` is the person (ADR 0016) and
  records as them.
- **Proposed by an agent, decided by a person.** An agent with write access may call
  `record_decision`; the call is **always** put to the person it works for, whatever an
  admin let its posts do without asking (`write_approval`, migration 0054), and recorded in
  that person's name with `proposed_by` naming the agent. A decision is the one write whose
  author must be a person for the record to mean anything.
- **Kept, not deleted.** A decision that stops standing is revoked — kept, marked, hidden
  until asked for — by the person who recorded it or an admin, who are also the only ones
  who reword it. How a team got where it is includes what it stopped deciding.
- **The message says so.** A message is the source of at most one standing decision
  (`decisions_message_live`), and every message read carries `decisionId` from one probe
  of that index in the shared message select — no column on `messages` to keep in step.
  Recording or revoking one rebroadcasts the source message, as pinning does; the socket
  vocabulary is unchanged.
- **Idempotent on the client's id**, as every write is.

## Consequences

- Migration 0057; `services/decision_log.py` (not `plugins/decisions.py`, which is an
  agent's question to a person), `routers/decision_log.py` (`/api/decisions`,
  `/api/channels/{id}/decisions`), `list_decisions` and `record_decision` in the tool
  catalogue for assistants and agents.
- The client has a Decisions page in the sidebar and ⌘K, a "Decided recently" card on
  Home when anything was decided in the last two weeks, a Decision mark under a source
  message, "Record as a decision" in the message menu, and Record beside a summary's
  decisions.
- Not built: decisions superseding one another by link, notifications when one is
  recorded, and a decision outside any conversation. A decision always lives somewhere a
  conversation can find it.
