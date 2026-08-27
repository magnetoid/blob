---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/src/blob_api/services/notify.py

Symbols in `apps/api/src/blob_api/services/notify.py`.

- L29 `Recipient` (class)
- L37 `NotifiableMessage` (class)
- L52 `Decision` (class)
- L59 `decide(message: NotifiableMessage, recipients: list[Recipient], now: datetime | None=None, thread_subscribers: set[str] | None=None, group_recipients: set[str] | None=None)` (function)
- L108 `is_snoozed(recipient: Recipient, now: datetime)` (function) — Manual snooze, or outside the user's configured working hours.
- L139 `_local_parts(moment: datetime, timezone: str)` (function)
- L148 `load_recipients(session: AsyncSession, channel_id: str)` (function) — Load the notification-relevant state for every member of a channel.
- L181 `load_group_recipients(session: AsyncSession, group_ids: list[str])` (function) — Everyone in these groups who has not muted them.
- L209 `load_thread_subscribers(session: AsyncSession, thread_root_id: str)` (function)
