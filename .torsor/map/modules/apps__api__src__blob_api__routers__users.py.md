---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L45 `UsersOut` (class)
- L49 `UserOut` (class)
- L53 `CurrentUserOut` (class)
- L57 `PrefsOut` (class)
- L61 `OkOut` (class)
- L66 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L171 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L208 `_write_profile(session: AsyncSession, user: SessionUser, payload: UpdateProfileInput, given: set[str])` (function) — The two writes a profile edit makes, so the caller can wrap both in one guard.
- L259 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L286 `list_users(user: SessionUser=Depends(current_user))` (function)
- L303 `get_user(user_id: str, user: SessionUser=Depends(current_user))` (function)
- L318 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L345 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
