---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T20:32:04'
updated: '2026-09-12T20:32:04'
---

# apps/api/src/blob_api/services/users.py

Symbols in `apps/api/src/blob_api/services/users.py`.

- L44 `_row(session: AsyncSession, user_id: str)` (function)
- L52 `bootstrap(session: AsyncSession, user: SessionUser)` (function) — Everything the client needs to render, in one answer.
- L149 `_status_expiry(payload: UpdateProfileInput, given: set[str])` (function) — The moment a status stops applying, as a datetime asyncpg will accept.
- L168 `_avatar_key(session: AsyncSession, user: SessionUser, attachment_id: str)` (function)
- L196 `update_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput)` (function) — Write a profile edit; returns the person's own view and the public one to send.
- L269 `update_prefs(session: AsyncSession, user_id: str, patch: dict[str, Any])` (function)
- L290 `list_users(session: AsyncSession, workspace_id: str)` (function)
- L305 `get_user(session: AsyncSession, workspace_id: str, user_id: str)` (function)
- L320 `push_subscriptions(session: AsyncSession, user_id: str)` (function)
- L336 `forget_push_subscriptions(session: AsyncSession, ids: list[str])` (function)
- L343 `add_push_subscription(session: AsyncSession, user_id: str, *, endpoint: str, p256dh: str, auth: str)` (function)
- L361 `remove_push_subscription(session: AsyncSession, user_id: str, endpoint: str)` (function)
