---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:46:45'
updated: '2026-08-21T03:46:45'
---

# apps/api/tests/helpers.py

Symbols in `apps/api/tests/helpers.py`.

- L26 `_alembic(*args: str)` (function)
- L37 `migrate_test_db()` (function) — Bring the test database to head, once per session.
- L49 `_inspect_schema()` (function)
- L63 `Response` (class)
- L68 `Client` (class) — A thin wrapper so tests read like the TypeScript suite they were ported from.
- L71 `__init__(self, http: httpx.AsyncClient)` (method)
- L76 `request(self, method: str, url: str, body: Any=None)` (method)
- L84 `get(self, url: str)` (method)
- L87 `post(self, url: str, body: Any=None)` (method)
- L90 `patch(self, url: str, body: Any=None)` (method)
- L93 `put(self, url: str, body: Any=None)` (method)
- L96 `delete(self, url: str, body: Any=None)` (method)
- L99 `fork(self)` (method) — A second client sharing no cookies — a different browser, same server.
- L107 `build_client()` (function)
- L114 `sign_up(client: Client, display_name: str, *, invite_token: str | None=None, email: str | None=None)` (function) — Sign up and leave the session cookie on the client's jar.
- L144 `invite_and_sign_up(owner: Client, display_name: str, role: str='member')` (function) — Mint an invite as the owner, then accept it on a fresh client.
- L152 `client_msg_id()` (function)
- L156 `send_message(client: Client, channel_id: str, body: str, **extra: Any)` (function)
