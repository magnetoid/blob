---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:50:24'
updated: '2026-09-02T04:50:24'
---

# apps/api/src/blob_api/services/notify.py

Symbols in `apps/api/src/blob_api/services/notify.py`.

- L30 `Recipient` (class)
- L38 `NotifiableMessage` (class)
- L53 `Decision` (class)
- L60 `decide(message: NotifiableMessage, recipients: list[Recipient], now: datetime | None=None, thread_subscribers: set[str] | None=None, group_recipients: set[str] | None=None)` (function)
- L109 `is_snoozed(recipient: Recipient, now: datetime)` (function) — Manual snooze, or outside the user's configured working hours.
- L145 `_local_parts(moment: datetime, timezone: str)` (function)
- L154 `load_recipients(session: AsyncSession, channel_id: str)` (function) — Load the notification-relevant state for every member of a channel.
- L187 `load_group_recipients(session: AsyncSession, group_ids: list[str])` (function) — Everyone in these groups who has not muted them.
- L215 `load_thread_subscribers(session: AsyncSession, thread_root_id: str)` (function)
