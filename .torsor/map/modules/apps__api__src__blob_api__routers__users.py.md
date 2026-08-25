---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T04:30:13'
updated: '2026-08-25T04:30:13'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L41 `UsersOut` (class)
- L45 `UserOut` (class)
- L49 `CurrentUserOut` (class)
- L53 `PrefsOut` (class)
- L57 `OkOut` (class)
- L62 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L154 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L213 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L240 `list_users(user: SessionUser=Depends(current_user))` (function)
- L257 `get_user(user_id: str, user: SessionUser=Depends(current_user))` (function)
- L272 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L299 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
