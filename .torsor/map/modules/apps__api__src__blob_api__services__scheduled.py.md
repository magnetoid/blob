---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T06:48:47'
updated: '2026-09-02T06:48:47'
---

# apps/api/src/blob_api/services/scheduled.py

Symbols in `apps/api/src/blob_api/services/scheduled.py`.

- L45 `_row_to_model(row: object)` (function)
- L65 `schedule(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, send_at: datetime, client_msg_id: str, thread_root_id: str | None=None, repeat: str | None=None, timezone: str='UTC')` (function) — Put a message aside to be sent at `send_at`.
- L144 `list_for_author(session: AsyncSession, author_id: str)` (function) — What this person has waiting, soonest first. Sent and cancelled rows are history.
- L171 `cancel(session: AsyncSession, author_id: str, scheduled_id: str)` (function) — Take it back — or, for one that already failed, dismiss the notice.
- L199 `due_batch(session: AsyncSession)` (function) — Claim the messages that are due. `SKIP LOCKED`, so two workers cannot both send one.
- L235 `deliver(session: AsyncSession, item: dict[str, object])` (function) — Send one due message, through the path every other message takes.
- L265 `mark_sent(session: AsyncSession, scheduled_id: str, message_id: str)` (function)
- L275 `advance(session: AsyncSession, item: dict[str, object], message_id: str)` (function) — Move a repeating row to its next occurrence. False if it does not repeat.
- L341 `mark_failed(session: AsyncSession, scheduled_id: str, reason: str)` (function) — Record why, and stand down.
