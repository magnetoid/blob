---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-17T02:03:40'
updated: '2026-09-17T02:03:40'
---

# apps/api/src/blob_api/services/users.py

Symbols in `apps/api/src/blob_api/services/users.py`.

- L45 `_row(session: AsyncSession, user_id: str)` (function)
- L53 `bootstrap(session: AsyncSession, user: SessionUser)` (function) — Everything the client needs to render, in one answer.
- L150 `_status_expiry(payload: UpdateProfileInput, given: set[str])` (function) — The moment a status stops applying, as a datetime asyncpg will accept.
- L169 `_avatar_key(session: AsyncSession, user: SessionUser, attachment_id: str)` (function)
- L197 `update_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput)` (function) — Write a profile edit; returns the person's own view and the public one to send.
- L270 `update_prefs(session: AsyncSession, user_id: str, patch: dict[str, Any])` (function)
- L291 `list_users(session: AsyncSession, workspace_id: str, *, active_only: bool=False)` (function) — Everybody in the workspace. The client wants the deactivated too — they still
- L337 `is_agent(session: AsyncSession, workspace_id: str, user_id: str)` (function) — Whether this member is an app's bot rather than a person.
- L348 `all_active(session: AsyncSession, workspace_id: str, user_ids: list[str])` (function) — Is every one of these a live member of this workspace?
- L366 `preferred_language(session: AsyncSession, user_id: str)` (function) — The language this person reads in, if they have said.
- L377 `get_user(session: AsyncSession, workspace_id: str, user_id: str)` (function)
- L392 `push_subscriptions(session: AsyncSession, user_id: str)` (function)
- L408 `forget_push_subscriptions(session: AsyncSession, ids: list[str])` (function)
- L415 `add_push_subscription(session: AsyncSession, user_id: str, *, endpoint: str, p256dh: str, auth: str)` (function)
- L433 `remove_push_subscription(session: AsyncSession, user_id: str, endpoint: str)` (function)
