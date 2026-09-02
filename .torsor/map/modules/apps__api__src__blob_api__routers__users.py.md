---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L49 `UsersOut` (class)
- L53 `UserOut` (class)
- L57 `CurrentUserOut` (class)
- L61 `PrefsOut` (class)
- L65 `OkOut` (class)
- L70 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L177 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L238 `_status_expiry(payload: UpdateProfileInput, given: set[str])` (function) — The moment a status stops applying, as a datetime asyncpg will accept.
- L257 `_write_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput, given: set[str], avatar_key: str | None=None)` (function) — The two writes a profile edit makes, so the caller can wrap both in one guard.
- L313 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L340 `list_users(user: SessionUser=Depends(current_user))` (function)
- L357 `get_user(user_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L371 `PushKeyOut` (class)
- L378 `push_public_key(user: SessionUser=Depends(current_user))` (function) — The VAPID public key a browser needs to subscribe.
- L388 `PushTestOut` (class)
- L396 `push_test(user: SessionUser=Depends(current_user))` (function) — Send yourself a test notification, so "did I set this up right" has a button.
- L438 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L465 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
