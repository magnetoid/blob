---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T00:18:00'
updated: '2026-09-13T00:18:00'
---

# apps/api/src/blob_api/services/emoji.py

Symbols in `apps/api/src/blob_api/services/emoji.py`.

- L20 `list_for_workspace(session: AsyncSession, workspace_id: str)` (function)
- L39 `add(session: AsyncSession, admin: SessionUser, *, name: str, attachment_id: str)` (function) — Name an image the admin uploaded. Returns the object key `:name:` now resolves to.
- L78 `remove(session: AsyncSession, workspace_id: str, name: str)` (function) — Take a name out of circulation. False when there was no such emoji.
