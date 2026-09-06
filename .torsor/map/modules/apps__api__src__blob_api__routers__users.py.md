---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-07T00:07:27'
updated: '2026-09-07T00:07:27'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L49 `UsersOut` (class)
- L53 `UserOut` (class)
- L57 `CurrentUserOut` (class)
- L61 `PrefsOut` (class)
- L65 `OkOut` (class)
- L70 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L181 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L249 `_status_expiry(payload: UpdateProfileInput, given: set[str])` (function) — The moment a status stops applying, as a datetime asyncpg will accept.
- L268 `_write_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput, given: set[str], avatar_key: str | None=None)` (function) — The two writes a profile edit makes, so the caller can wrap both in one guard.
- L324 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L351 `list_users(user: SessionUser=Depends(current_user))` (function)
- L368 `get_user(user_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L382 `PushKeyOut` (class)
- L389 `push_public_key(user: SessionUser=Depends(current_user))` (function) — The VAPID public key a browser needs to subscribe.
- L399 `PushTestOut` (class)
- L411 `push_test(user: SessionUser=Depends(current_user))` (function) — Send yourself a test notification, so "did I set this up right" has a button.
- L456 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L483 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
