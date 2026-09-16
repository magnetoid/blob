---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/lib/auth.py

Symbols in `apps/api/src/blob_api/lib/auth.py`.

- L32 `build_hasher(profile: str, *, testing: bool)` (function) — The hasher for this process.
- L52 `hash_token(token: str)` (function)
- L56 `hash_password(plain: str)` (function)
- L61 `verify_password(hash_value: str, plain: str)` (function)
- L72 `SessionUser` (class)
- L81 `is_admin(self)` (method)
- L85 `create_session(user_id: str, user_agent: str | None, ip: str | None)` (function)
- L109 `resolve_session(token: str)` (function)
- L153 `destroy_session(session_id: str)` (function)
- L159 `destroy_other_sessions(user_id: str, keep_session_id: str | None=None)` (function) — Sign out everywhere, optionally keeping the session making the request.
- L175 `set_session_cookie(response: Response, token: str)` (function)
- L187 `clear_session_cookie(response: Response)` (function)
- L191 `current_user(request: Request)` (function) — The signed-in user, or 401.
- L199 `require_admin(request: Request)` (function) — Admin or owner, else 403.
- L211 `require_owner(request: Request)` (function)
- L218 `require_instance_admin(request: Request)` (function) — Administers the server, not a workspace on it.
