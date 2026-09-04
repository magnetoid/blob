---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:43'
updated: '2026-09-04T07:26:43'
---

# apps/api/src/blob_api/services/catchup.py

Symbols in `apps/api/src/blob_api/services/catchup.py`.

- L48 `ChannelSummary` (class)
- L58 `refuse_unconfigured()` (function)
- L66 `unread_channels(session: AsyncSession, *, workspace_id: str, user_id: str, channel_id: str | None)` (function) — The channels with something unread, busiest mentions first.
- L104 `unread_messages(session: AsyncSession, *, channel_id: str, after_id: str | None)` (function)
- L129 `summarise(session: AsyncSession, *, workspace_id: str, user_id: str, channel_id: str | None)` (function) — Summaries for everything unread — one channel when asked, else the busiest few.
