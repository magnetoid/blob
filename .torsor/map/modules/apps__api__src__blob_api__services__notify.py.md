---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T00:27:10'
updated: '2026-08-22T00:27:10'
---

# apps/api/src/blob_api/services/notify.py

Symbols in `apps/api/src/blob_api/services/notify.py`.

- L29 `Recipient` (class)
- L37 `NotifiableMessage` (class)
- L49 `Decision` (class)
- L56 `decide(message: NotifiableMessage, recipients: list[Recipient], now: datetime | None=None, thread_subscribers: set[str] | None=None)` (function)
- L94 `is_snoozed(recipient: Recipient, now: datetime)` (function) — Manual snooze, or outside the user's configured working hours.
- L125 `_local_parts(moment: datetime, timezone: str)` (function)
- L134 `load_recipients(session: AsyncSession, channel_id: str)` (function) — Load the notification-relevant state for every member of a channel.
- L161 `load_thread_subscribers(session: AsyncSession, thread_root_id: str)` (function)
