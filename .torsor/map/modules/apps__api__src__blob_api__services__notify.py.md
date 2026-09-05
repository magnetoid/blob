---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/services/notify.py

Symbols in `apps/api/src/blob_api/services/notify.py`.

- L30 `Recipient` (class)
- L38 `NotifiableMessage` (class)
- L59 `Decision` (class)
- L66 `decide(message: NotifiableMessage, recipients: list[Recipient], now: datetime | None=None, thread_subscribers: set[str] | None=None, group_recipients: set[str] | None=None, active_user_ids: set[str] | None=None)` (function)
- L122 `_reached_by_everyone(message: NotifiableMessage, user_id: str, active_user_ids: set[str] | None)` (function) — Whether a channel-wide mention reaches this person.
- L140 `is_snoozed(recipient: Recipient, now: datetime)` (function) — Manual snooze, or outside the user's configured working hours.
- L176 `_local_parts(moment: datetime, timezone: str)` (function)
- L185 `load_recipients(session: AsyncSession, channel_id: str)` (function) — Load the notification-relevant state for every member of a channel.
- L218 `load_group_recipients(session: AsyncSession, group_ids: list[str])` (function) — Everyone in these groups who has not muted them.
- L246 `load_thread_subscribers(session: AsyncSession, thread_root_id: str)` (function)
