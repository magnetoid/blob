---
type: decision
status: accepted
tags: [adr, data, privacy, retention, compliance]
links:
  [
    0038-an-export-takes-what-its-asker-may-take,
    0015-summaries-cite-and-nudges-stay-private,
    0024-what-an-agent-remembers-is-somebodys,
  ]
rules: []
---

# ADR 0039: Retention removes the talk, never the work, and a hold stops it

## Context

Blob kept every message and every file for as long as the database lasted; the one
retention setting it had was the audit log's. A team with a duty to keep data no longer
than it needs it (GDPR's storage limitation), or a policy that chat is not a record, could
not run it. Slack and Mattermost both offer a workspace window for messages and another
for files, and both pair it with a legal hold, so that a lawsuit can stop the clock for
what it is about. Slack's hold is placed on people (custodians) and keeps what they edit
or delete too, readable later through an export; Mattermost's is placed on users as well.

## Decision

**An admin may set how long messages, and separately files, are kept. Past the line a
nightly sweep removes them. A conversation, or a person, on legal hold is skipped.**

- **Two windows, both off by default.** Messages, and files, each "keep forever" or a
  number of days (1–3,650). A file window shorter than the message window removes files
  sooner and keeps the words; a file never outlives its message.
- **Past the message line a message becomes the tombstone a delete leaves** — row kept,
  `deleted_at` set, body, blocks, mentions and reactions gone — and loses what a delete
  still leaves behind today: its files (object first, then row, then thumbnail), its link
  preview and its picture, its translations, its thread's stored summary, its pin and its
  place in anyone's Later. Threads keep their shape: a root whose replies are still inside
  the window stays as "This message was deleted". What agents kept about that talk goes
  with it — runs started before the line (their cards, approvals and trails) and memory
  and notes of the conversation untouched since.
- **Past the file line a message keeps its words** and loses its files and its preview's
  picture, with a count left on it so a reader sees "2 files removed" rather than nothing.
- **What stays: tasks, decisions and work artifacts.** A thread that reached a decision
  leaves the decision behind; retention removes the talk that led to it. The audit log keeps
  its own window, and backups keep theirs (`BACKUP_KEEP_DAYS`). The sweep runs an hour after
  the nightly backup, so the night's removals are in the dump taken before them.
- **A change waits a day.** A new window takes effect 24 hours after it is saved, so a
  wrong choice can be put back before anything goes. Saving asks for a recent sign-in, shows
  what the first sweep would remove, and is recorded in the audit log with the before and
  after; every sweep is recorded with its counts.
- **Storage first, rows second** (the orphan sweep's rule): a message whose file could not
  be deleted stays as it is until the next night, so no object is ever left with nothing
  pointing at it.
- **Legal hold, on a conversation or a person.** A held conversation, every conversation a
  held person is in, and everything a held person wrote are skipped by both windows. A
  conversation's hold is shown to its members in its details; a person's to that person.
  Everybody else is told the rule — "unless the conversation, or someone in it, is on legal
  hold" — and not who: who is a custodian is the legal team's to say.

## Consequences

- Migration 0071: `channels.legal_hold_at/_by`, `users.legal_hold_at/_by`,
  `messages.files_removed`. The windows live in `workspace_settings` and only
  `PUT /api/admin/retention` writes them; the generic settings route refuses their keys.
- "Past the line" is an id comparison: ids are UUIDv7, so the line is the smallest id the
  cutoff instant could have, and the sweep walks the primary key rather than an index on
  `created_at` the table does not have. A watermark per workspace (in Redis — losing it
  costs one full walk) keeps each night to the day that crossed the line; a weekly walk, a
  changed window and a released hold start from the beginning again.
- A deleted message nobody replied to leaves channel history and threads altogether, as
  Slack's does and as the live client already did — so a swept year is not a wall of
  tombstones. The reconnect replay still reports them, so a client drops what it held.
- One `history.trimmed` frame per conversation per batch rather than a frame per message: a
  first sweep over years of history is millions of rows, and only a client that has
  scrolled back that far has anything to refetch.
- Bounded: 500 messages a transaction, twenty minutes a night; a first sweep over a long
  history finishes over several nights.
- **Not decided: what a hold does about deletes.** A hold here does not keep what people
  delete or edit themselves. Slack's does, silently, and makes the copies readable through
  an export; a hidden copy of what somebody deleted is the surveillance the privacy
  principle refuses, and ADR 0038 gives no admin a way to read private conversations out.
  The honest alternative — a held conversation refuses deletes and edits, and says why —
  changes a habit every Slack user has and needs its own decision.
