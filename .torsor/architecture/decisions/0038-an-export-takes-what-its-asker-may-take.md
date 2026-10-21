---
type: decision
status: accepted
tags: [adr, data, privacy, export]
links:
  [
    0034-a-guest-is-in-the-channels-they-were-invited-to,
    0031-a-persons-sign-in-is-the-addresss,
  ]
rules: []
---

# ADR 0038: An export takes what its asker may take

## Context

Blob had no way out: no workspace export, no personal one. Slack's standard export is a
workspace's public channels; its full one, private channels and DMs, sits behind an
Enterprise plan and an approval. Blob holds nothing back behind a plan, so the question was
not which tier gets what but which person may carry what out.

## Decision

**An admin exports the workspace's public conversations and its people; a person exports
everything they are in. Neither carries out a private channel or a DM somebody else is in.**

- **Workspace (`/api/admin/exports`, admins).** Every public channel, archived ones too, with
  messages, reactions and a file manifest, and every person in the workspace with their
  address — what an admin already sees in the console. A private channel's existence is
  private (it answers 404 to outsiders) and a DM is two people's, so neither leaves through
  an admin.
- **Personal (`/api/me/exports`, anybody).** Every conversation the person is a member of —
  public, private, DMs and group DMs — and the people in them, with no address but their own.
- **Both ask for a recent sign-in** (ADR 0031): an export is everything at once.
- **Built by the worker, kept a week.** `blob-export/1`, a zip of JSON lines — `export.json`,
  `users.jsonl`, `channels.jsonl`, `messages/<id>.jsonl` (one per conversation, empty or not),
  `files.jsonl` — in object storage under `exports/`, fetched through Blob's own download
  link, which answers to whoever asked and, for a workspace export, to its admins.

## Consequences

- Migration 0070 (`exports`); one build per person at a time, five requests an hour.
- Files are listed, not packed: names, types, sizes and ids, with the bytes left in the
  bucket. A zip of every upload is a different size of problem.
- Not built: importing an export (or Slack's), scheduled exports, and an owner's full export
  of private conversations — which would need its own decision about consent.
