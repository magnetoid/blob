---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:46:45'
updated: '2026-08-21T03:46:45'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L38 `UsersOut` (class)
- L42 `UserOut` (class)
- L46 `CurrentUserOut` (class)
- L50 `PrefsOut` (class)
- L54 `OkOut` (class)
- L59 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L134 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L193 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L220 `list_users(user: SessionUser=Depends(current_user))` (function)
- L237 `get_user(user_id: str, user: SessionUser=Depends(current_user))` (function)
- L252 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L279 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
