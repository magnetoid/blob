---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/helpers.py

Symbols in `apps/api/tests/helpers.py`.

- L27 `_alembic(*args: str)` (function)
- L41 `_ensure_database()` (function) — Create this process's database if it is not there yet.
- L61 `migrate_test_db()` (function) — Bring the test database to head, once per session.
- L74 `_inspect_schema()` (function)
- L88 `Response` (class)
- L96 `Client` (class) — A thin wrapper so tests read like the TypeScript suite they were ported from.
- L99 `__init__(self, http: httpx.AsyncClient)` (method)
- L104 `request(self, method: str, url: str, body: Any=None)` (method)
- L116 `get(self, url: str)` (method)
- L119 `post(self, url: str, body: Any=None)` (method)
- L122 `patch(self, url: str, body: Any=None)` (method)
- L125 `put(self, url: str, body: Any=None)` (method)
- L128 `delete(self, url: str, body: Any=None)` (method)
- L131 `fork(self)` (method) — A second client sharing no cookies — a different browser, same server.
- L139 `build_client()` (function)
- L146 `sign_up(client: Client, display_name: str, *, invite_token: str | None=None, email: str | None=None)` (function) — Sign up and leave the session cookie on the client's jar.
- L176 `invite_and_sign_up(owner: Client, display_name: str, role: str='member')` (function) — Mint an invite as the owner, then accept it on a fresh client.
- L184 `client_msg_id()` (function)
- L188 `send_message(client: Client, channel_id: str, body: str, **extra: Any)` (function)
- L193 `allow_policy(workspace_id: str, **fields: object)` (function) — Open a capability for a workspace, straight into the table.
- L234 `workspace_id_of(client: Client)` (function) — The workspace this client is signed into.
