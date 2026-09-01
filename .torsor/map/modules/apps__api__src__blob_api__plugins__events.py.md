---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T23:39:48'
updated: '2026-09-01T23:39:48'
---

# apps/api/src/blob_api/plugins/events.py

Symbols in `apps/api/src/blob_api/plugins/events.py`.

- L53 `emit(session: AsyncSession, *, workspace_id: str, event: str, payload: dict[str, Any], channel_id: str | None=None, exclude_plugin_id: str | None=None, only_plugin_id: str | None=None)` (function) — Queue `event` for every enabled plugin subscribed to it. Returns delivery ids.
