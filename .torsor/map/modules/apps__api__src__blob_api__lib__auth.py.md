---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T03:21:57'
updated: '2026-08-22T03:21:57'
---

# apps/api/src/blob_api/lib/auth.py

Symbols in `apps/api/src/blob_api/lib/auth.py`.

- L36 `hash_token(token: str)` (function)
- L40 `hash_password(plain: str)` (function)
- L45 `verify_password(hash_value: str, plain: str)` (function)
- L56 `SessionUser` (class)
- L65 `is_admin(self)` (method)
- L69 `create_session(user_id: str, user_agent: str | None, ip: str | None)` (function)
- L93 `resolve_session(token: str)` (function)
- L138 `destroy_session(session_id: str)` (function)
- L144 `destroy_other_sessions(user_id: str, keep_session_id: str | None=None)` (function) — Sign out everywhere, optionally keeping the session making the request.
- L160 `set_session_cookie(response: Response, token: str)` (function)
- L172 `clear_session_cookie(response: Response)` (function)
- L176 `current_user(request: Request)` (function) — The signed-in user, or 401.
- L184 `require_admin(request: Request)` (function) — Admin or owner, else 403.
- L196 `require_owner(request: Request)` (function)
