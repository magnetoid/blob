---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/services/user_groups.py

Symbols in `apps/api/src/blob_api/services/user_groups.py`.

- L36 `Group` (class)
- L44 `clean_handle(raw: str)` (function) — Normalise what somebody typed, then insist on the rule.
- L56 `create(session: AsyncSession, *, workspace_id: str, handle: str, name: str, description: str | None, created_by: str)` (function)
- L88 `rename(session: AsyncSession, *, workspace_id: str, group_id: str, handle: str | None, name: str | None, description: str | None, touch_description: bool)` (function)
- L128 `delete(session: AsyncSession, workspace_id: str, group_id: str)` (function) — Remove the group. The handle row goes with it by cascade.
- L145 `add_member(session: AsyncSession, workspace_id: str, group_id: str, user_id: str)` (function) — Put somebody in a group. Humans only, and idempotent.
- L180 `remove_member(session: AsyncSession, workspace_id: str, group_id: str, user_id: str)` (function)
- L197 `set_muted(session: AsyncSession, group_id: str, user_id: str, muted: bool)` (function) — Your own switch for a group you are in. Returns False if you are not in it.
- L215 `exists(session: AsyncSession, workspace_id: str, group_id: str)` (function)
- L219 `by_id(session: AsyncSession, workspace_id: str, group_id: str)` (function)
- L237 `list_for_workspace(session: AsyncSession, workspace_id: str)` (function)
- L256 `member_ids(session: AsyncSession, group_id: str)` (function)
- L274 `group_ids_for_user(session: AsyncSession, user_id: str)` (function) — Which groups this person is in — for the boot payload, so the client can tell
- L286 `muted_group_ids_for_user(session: AsyncSession, user_id: str)` (function) — Which of those groups this person has silenced — so the toggle can show truth.
- L297 `_to_group(row: Any)` (function)
