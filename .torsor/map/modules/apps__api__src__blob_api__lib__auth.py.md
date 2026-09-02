---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T02:51:23'
updated: '2026-09-02T02:51:23'
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
- L137 `destroy_session(session_id: str)` (function)
- L143 `destroy_other_sessions(user_id: str, keep_session_id: str | None=None)` (function) — Sign out everywhere, optionally keeping the session making the request.
- L159 `set_session_cookie(response: Response, token: str)` (function)
- L171 `clear_session_cookie(response: Response)` (function)
- L175 `current_user(request: Request)` (function) — The signed-in user, or 401.
- L183 `require_admin(request: Request)` (function) — Admin or owner, else 403.
- L195 `require_owner(request: Request)` (function)
- L202 `require_instance_admin(request: Request)` (function) — Administers the server, not a workspace on it.
