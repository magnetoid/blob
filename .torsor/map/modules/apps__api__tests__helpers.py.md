---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T22:36:29'
updated: '2026-08-24T22:36:29'
---

# apps/api/tests/helpers.py

Symbols in `apps/api/tests/helpers.py`.

- L26 `_alembic(*args: str)` (function)
- L37 `migrate_test_db()` (function) — Bring the test database to head, once per session.
- L49 `_inspect_schema()` (function)
- L63 `Response` (class)
- L71 `Client` (class) — A thin wrapper so tests read like the TypeScript suite they were ported from.
- L74 `__init__(self, http: httpx.AsyncClient)` (method)
- L79 `request(self, method: str, url: str, body: Any=None)` (method)
- L91 `get(self, url: str)` (method)
- L94 `post(self, url: str, body: Any=None)` (method)
- L97 `patch(self, url: str, body: Any=None)` (method)
- L100 `put(self, url: str, body: Any=None)` (method)
- L103 `delete(self, url: str, body: Any=None)` (method)
- L106 `fork(self)` (method) — A second client sharing no cookies — a different browser, same server.
- L114 `build_client()` (function)
- L121 `sign_up(client: Client, display_name: str, *, invite_token: str | None=None, email: str | None=None)` (function) — Sign up and leave the session cookie on the client's jar.
- L151 `invite_and_sign_up(owner: Client, display_name: str, role: str='member')` (function) — Mint an invite as the owner, then accept it on a fresh client.
- L159 `client_msg_id()` (function)
- L163 `send_message(client: Client, channel_id: str, body: str, **extra: Any)` (function)
