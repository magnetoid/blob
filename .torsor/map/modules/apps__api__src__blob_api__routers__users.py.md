---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T23:39:49'
updated: '2026-09-01T23:39:49'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L48 `UsersOut` (class)
- L52 `UserOut` (class)
- L56 `CurrentUserOut` (class)
- L60 `PrefsOut` (class)
- L64 `OkOut` (class)
- L69 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L176 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L237 `_status_expiry(payload: UpdateProfileInput, given: set[str])` (function) — The moment a status stops applying, as a datetime asyncpg will accept.
- L259 `_write_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput, given: set[str], avatar_key: str | None=None)` (function) — The two writes a profile edit makes, so the caller can wrap both in one guard.
- L315 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L342 `list_users(user: SessionUser=Depends(current_user))` (function)
- L359 `get_user(user_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L373 `PushKeyOut` (class)
- L380 `push_public_key(user: SessionUser=Depends(current_user))` (function) — The VAPID public key a browser needs to subscribe.
- L390 `PushTestOut` (class)
- L398 `push_test(user: SessionUser=Depends(current_user))` (function) — Send yourself a test notification, so "did I set this up right" has a button.
- L440 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L467 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
