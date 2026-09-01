---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:52'
updated: '2026-09-01T22:51:52'
---

# apps/api/src/blob_api/services/scheduled.py

Symbols in `apps/api/src/blob_api/services/scheduled.py`.

- L40 `_row_to_model(row: object)` (function)
- L54 `schedule(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, send_at: datetime, client_msg_id: str, thread_root_id: str | None=None)` (function) — Put a message aside to be sent at `send_at`.
- L118 `list_for_author(session: AsyncSession, author_id: str)` (function) — What this person has waiting, soonest first. Sent and cancelled rows are history.
- L138 `cancel(session: AsyncSession, author_id: str, scheduled_id: str)` (function) — Take it back. Only the author's own, and only while it is still waiting.
- L160 `due_batch(session: AsyncSession)` (function) — Claim the messages that are due. `SKIP LOCKED`, so two workers cannot both send one.
- L193 `deliver(session: AsyncSession, item: dict[str, object])` (function) — Send one due message, through the path every other message takes.
- L216 `mark_sent(session: AsyncSession, scheduled_id: str, message_id: str)` (function)
- L226 `mark_failed(session: AsyncSession, scheduled_id: str, reason: str)` (function) — Record why, and stand down.
