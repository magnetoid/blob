---
type: charter
status: active
tags: [charter]
---

# Project Charter

## What we are building

Blob is an open-source, self-hosted AI agentic work-team communication platform, and it
deliberately looks and feels like Slack: channels, DMs, threads, reactions, mentions,
full-history search and live presence, with
a superadmin console, a theme system and an app platform where agents are members of the
workspace rather than integrations beside it. One workspace per deployment, run by the
team that uses it.

## Why it exists

Teams that want their conversation history in their own Postgres — no per-seat pricing,
no message cap, no third party holding the archive — currently choose between hosted
Slack and self-hosted tools that feel a decade old. Blob is for an internal team of under
a hundred people who want the former's feel on the latter's terms, with humans and agents
working in the same rooms under the same permissions.

## Non-negotiable principles

- **Open source, and agent-native.** Blob is an open-source AI agentic work-team
  communication platform. Every feature ships in this repo under one licence, with nothing
  held back behind a plan check or an enterprise tier — the deployment a team runs is the
  whole product. Agents join a workspace as real members with real permissions, and their
  output lands in the conversation rather than in a panel bolted beside it.
- **As familiar as Slack.** Someone who uses Slack should not have to learn Blob: the same
  layout, the same words for things — channels, threads, DMs, reactions, ⌘K — and the same
  keyboard reflexes. Where a cleverer interaction competes with the one Slack users already
  have in their fingers, ship Slack's. The only exceptions are the other principles on this
  list, and each one is a deliberate departure rather than a difference for its own sake.
- **The client is the contract.** The React app is the acceptance test for the server. If
  an unmodified client breaks, the server is wrong — this is what carried the TypeScript →
  Python rewrite without a single frontend change.
- **Persist, then broadcast.** No event is ever emitted from inside a transaction. A
  client must never be told about a row that has not committed.
- **Hand-tuned SQL stays SQL.** The chat queries are tuned and tested; they live in
  `text()` verbatim rather than being re-expressed as query-builder chains.
- **Ids are UUIDv7.** Chronological sort order is load-bearing: unread state is a string
  comparison, not a count or a timestamp join. This is the one schema decision that
  cannot be retrofitted cheaply.
- **Every write is idempotent on a client-supplied id.** That is what makes optimistic UI
  and offline retry safe rather than duplicating messages.
- **Privacy is a feature, not a gap.** No read receipts. No presence or typing events for
  apps. Private channels answer 404, not 403, because their existence is private.
- **Fail toward the workspace staying up.** A dead mail server, a broken plugin, a slow
  app or a failed unfurl degrades that one thing and nothing else.
