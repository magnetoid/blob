---
type: decision
status: accepted
tags: [adr, plugins, agents, protocol, interop]
links: [0005-bots-are-real-users, 0010-agents-deploy-as-containers, 0004-persist-then-broadcast]
rules: []
---

# ADR 0011: Blob is the AG-UI client, and an agent's answer is written once

## Context
An agent-native workspace is only open if agents built elsewhere can join it. Until now
every app had to be written against Blob: subscribe to `message.created`, verify an HMAC,
hold a bot token, call `chat.postMessage`. That is a day of work per agent and it is the
same day every time — exactly the bespoke glue that keeps a small open-source product out
of other people's toolchains.

AG-UI is an open, event-based protocol for agents talking to user-facing applications. It
is pre-1.0 and moving, but it is already implemented on the agent side by LangGraph,
CrewAI, PydanticAI, Google ADK, AWS Strands and the Claude Agent SDK. Supporting it means
an agent whose only Blob-specific artefact is a manifest can answer in a channel.

Two questions had to be settled before any of it could be written.

## Decision

### Blob is the client; the agent is the server
Blob POSTs a `RunAgentInput` to the app's endpoint and reads back an SSE event stream.

The alternative — agents push events into Blob — is superficially more natural for a chat
product, and it is wrong. Every framework above ships an AG-UI *server*; not one ships a
client that pushes into somebody else's inbox. Making the agent push would mean every one
of those frameworks needs an adapter written by hand, which is the cost this exists to
remove. Being the client is what makes "your existing agent already works" true.

### An answer is buffered and written once, never streamed into an edit
Nothing is written until `TEXT_MESSAGE_END`. One AG-UI text message becomes one Blob row,
complete when it is written. A message past the size cap becomes a second row, not a
truncation and not an edit.

Streaming tokens into a message via `edit()` was the obvious alternative and fails on four
counts. [[0004-persist-then-broadcast]] exists so a client is never told about something
that is not true yet, and broadcasting a body that will change forty more times is forty
broadcasts of a truth that was never true. `send()` is idempotent on a client-supplied id
and `edit()` is not, so a worker that died mid-stream would have to replay every delta to
reconstruct the same row, leaving half an answer in the channel until it did. `edit()`
stamps `edited_at`, which the client renders as "(edited)" — so every agent answer would
be permanently marked edited and would flicker once per token on the way there. And a
chatty agent would cost 4,000 UPDATEs, 4,000 fanouts and 4,000 outbox rows where a terse
one costs three.

The honest cost is that **a slow agent is silent until it is done**, and it is stated in
the docs rather than papered over with a "thinking…" message that would need the very
edit path this refuses. The bound on that silence is `AGUI_TIMEOUT_SEC`: after it, the
person is told the agent could not finish.

Real token streaming is a coherent future slice. It needs a `streaming` flag on the wire,
an update path that does not stamp `edited_at`, and a frontend change — which is why it is
named here instead of being smuggled in.

### Unknown events are ignored, never fatal
Ten event types are acted on; the rest — state, reasoning, steps, snapshots, anything
added after this was written — are inert. The protocol is pre-1.0 and gaining events, and
a strict discriminated union over its catalogue would turn next month's addition into a
dead agent. For the same reason the official SDK is a *test* dependency used as a
conformance oracle, not a runtime one.

## Consequences
- An app declares `aguiUrl` in its manifest and needs no webhook handler and no bot token
  to answer a mention. It still needs `messages:write`, and its bot still has to be a
  member of the channel: AG-UI adds a transport, never a capability.
- Only a message from a *person* starts a run. This was the loop guard, structural rather
  than a depth counter. **Qualified by [[0013-agent-chains-carry-human-authority]]:** a
  person still roots every chain, but an agent's reply may now extend the chain it is in
  by one hop, on that person's authority and inside a depth budget. A bot's message with
  no parent run — the bot API — still starts nothing.
- A run's identity is `agui:{trigger message id}:{agui message id}`, written to
  `client_msg_id`. The unique index that already makes every write idempotent is therefore
  the run ledger, and no new table was needed to hold one.
- A mentioned agent runs in the worker, so a hung agent occupies one of eight job slots
  for up to `AGUI_TIMEOUT_SEC`. Accepted for now; the fix, if it bites, is a second worker
  on its own queue, which is configuration rather than redesign.
- The endpoint is checked against the SSRF guard at registration, exactly as a webhook URL
  is — and, exactly as with a webhook URL, not re-checked at fetch time. DNS rebinding
  after registration stays reachable for both. Fixing it is one change to both paths, not
  a reason to hold this one.
