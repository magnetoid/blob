---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/services/users.py

Symbols in `apps/api/src/blob_api/services/users.py`.

- L44 `_row(session: AsyncSession, user_id: str)` (function)
- L52 `bootstrap(session: AsyncSession, user: SessionUser)` (function) — Everything the client needs to render, in one answer.
- L149 `_status_expiry(payload: UpdateProfileInput, given: set[str])` (function) — The moment a status stops applying, as a datetime asyncpg will accept.
- L168 `_avatar_key(session: AsyncSession, user: SessionUser, attachment_id: str)` (function)
- L196 `update_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput)` (function) — Write a profile edit; returns the person's own view and the public one to send.
- L269 `update_prefs(session: AsyncSession, user_id: str, patch: dict[str, Any])` (function)
- L290 `list_users(session: AsyncSession, workspace_id: str, *, active_only: bool=False)` (function) — Everybody in the workspace. The client wants the deactivated too — they still
- L321 `is_agent(session: AsyncSession, workspace_id: str, user_id: str)` (function) — Whether this member is an app's bot rather than a person.
- L332 `all_active(session: AsyncSession, workspace_id: str, user_ids: list[str])` (function) — Is every one of these a live member of this workspace?
- L350 `preferred_language(session: AsyncSession, user_id: str)` (function) — The language this person reads in, if they have said.
- L361 `get_user(session: AsyncSession, workspace_id: str, user_id: str)` (function)
- L376 `push_subscriptions(session: AsyncSession, user_id: str)` (function)
- L392 `forget_push_subscriptions(session: AsyncSession, ids: list[str])` (function)
- L399 `add_push_subscription(session: AsyncSession, user_id: str, *, endpoint: str, p256dh: str, auth: str)` (function)
- L417 `remove_push_subscription(session: AsyncSession, user_id: str, endpoint: str)` (function)
