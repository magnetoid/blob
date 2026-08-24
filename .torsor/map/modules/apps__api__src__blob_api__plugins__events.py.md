---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T17:27:50'
updated: '2026-08-24T17:27:50'
---

# apps/api/src/blob_api/plugins/events.py

Symbols in `apps/api/src/blob_api/plugins/events.py`.

- L50 `emit(session: AsyncSession, *, workspace_id: str, event: str, payload: dict[str, Any], channel_id: str | None=None, exclude_plugin_id: str | None=None, only_plugin_id: str | None=None)` (function) — Queue `event` for every enabled plugin subscribed to it. Returns delivery ids.
- L157 `has_subscribers(session: AsyncSession, workspace_id: str, event: str)` (function) — Whether emitting is worth the payload construction on a hot path.
