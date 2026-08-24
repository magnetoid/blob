---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T16:51:20'
updated: '2026-08-24T16:51:20'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L40 `UsersOut` (class)
- L44 `UserOut` (class)
- L48 `CurrentUserOut` (class)
- L52 `PrefsOut` (class)
- L56 `OkOut` (class)
- L61 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L151 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L210 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L237 `list_users(user: SessionUser=Depends(current_user))` (function)
- L254 `get_user(user_id: str, user: SessionUser=Depends(current_user))` (function)
- L269 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L296 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
