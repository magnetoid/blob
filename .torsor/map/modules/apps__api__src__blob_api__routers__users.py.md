---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/users.py

Symbols in `apps/api/src/blob_api/routers/users.py`.

- L31 `UsersOut` (class)
- L35 `UserOut` (class)
- L39 `CurrentUserOut` (class)
- L43 `PrefsOut` (class)
- L48 `bootstrap(user: SessionUser=Depends(current_user))` (function) — One request that returns everything the client needs to render.
- L58 `update_me(payload: UpdateProfileInput, user: SessionUser=Depends(current_user))` (function)
- L73 `update_prefs(payload: UpdatePrefsInput, user: SessionUser=Depends(current_user))` (function)
- L83 `list_users(user: SessionUser=Depends(current_user))` (function)
- L89 `get_user(user_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L95 `PushKeyOut` (class)
- L102 `push_public_key(user: SessionUser=Depends(current_user))` (function) — The VAPID public key a browser needs to subscribe.
- L112 `PushTestOut` (class)
- L124 `push_test(user: SessionUser=Depends(current_user))` (function) — Send yourself a test notification, so "did I set this up right" has a button.
- L156 `add_push_subscription(payload: PushSubscriptionInput, user: SessionUser=Depends(current_user))` (function)
- L171 `remove_push_subscription(payload: PushUnsubscribeInput, user: SessionUser=Depends(current_user))` (function)
