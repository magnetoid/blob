---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L47 `UsersOut` (class)
- L51 `UserOut` (class)
- L55 `CurrentUserOut` (class)
- L59 `PrefsOut` (class)
- L63 `OkOut` (class)
- L68 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L175 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L236 `_write_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput, given: set[str], avatar_key: str | None=None)` (function) — The two writes a profile edit makes, so the caller can wrap both in one guard.
- L292 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L319 `list_users(user: SessionUser=Depends(current_user))` (function)
- L336 `get_user(user_id: str, user: SessionUser=Depends(current_user))` (function)
- L350 `PushKeyOut` (class)
- L357 `push_public_key(user: SessionUser=Depends(current_user))` (function) — The VAPID public key a browser needs to subscribe.
- L367 `PushTestOut` (class)
- L375 `push_test(user: SessionUser=Depends(current_user))` (function) — Send yourself a test notification, so "did I set this up right" has a button.
- L417 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L444 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
