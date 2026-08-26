---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:49:02'
updated: '2026-08-26T05:49:02'
---

# apps/api/src/blob_api/services/handles.py

Symbols in `apps/api/src/blob_api/services/handles.py`.

- L29 `claim(session: AsyncSession, workspace_id: str, name: str, *, user_id: str | None=None, group_id: str | None=None)` (function) — Take a name for a user or a group. Raises on 23505 if it is taken.
- L54 `release_user(session: AsyncSession, user_id: str)` (function) — Give up whatever handle this person holds — deactivation, or a rename.
- L67 `release_group(session: AsyncSession, group_id: str)` (function)
- L74 `rehandle_user(session: AsyncSession, workspace_id: str, user_id: str, name: str)` (function) — Move a person onto a new name, releasing the old one in the same statement pair.
- L84 `is_taken(session: AsyncSession, workspace_id: str, name: str)` (function) — Only for suggesting an alternative, never for guarding a write.
