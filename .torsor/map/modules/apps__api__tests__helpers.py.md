---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/tests/helpers.py

Symbols in `apps/api/tests/helpers.py`.

- L27 `_alembic(*args: str)` (function)
- L41 `_ensure_database()` (function) — Create this process's database if it is not there yet.
- L61 `migrate_test_db()` (function) — Bring the test database to head, once per session.
- L74 `_inspect_schema()` (function)
- L88 `Response` (class)
- L96 `_wrap(response: httpx.Response)` (function)
- L108 `Client` (class) — A thin wrapper so tests read like the TypeScript suite they were ported from.
- L111 `__init__(self, http: httpx.AsyncClient)` (method)
- L116 `request(self, method: str, url: str, body: Any=None)` (method)
- L120 `post_raw(self, url: str, content: str, headers: dict[str, str])` (method) — A body sent exactly as given, for callers that sign the bytes — LiveKit's
- L125 `get(self, url: str)` (method)
- L128 `post(self, url: str, body: Any=None)` (method)
- L131 `patch(self, url: str, body: Any=None)` (method)
- L134 `put(self, url: str, body: Any=None)` (method)
- L137 `delete(self, url: str, body: Any=None)` (method)
- L140 `fork(self)` (method) — A second client sharing no cookies — a different browser, same server.
- L148 `build_client()` (function)
- L155 `sign_up(client: Client, display_name: str, *, invite_token: str | None=None, email: str | None=None)` (function) — Sign up and leave the session cookie on the client's jar.
- L185 `invite_and_sign_up(owner: Client, display_name: str, role: str='member')` (function) — Mint an invite as the owner, then accept it on a fresh client.
- L193 `client_msg_id()` (function)
- L197 `send_message(client: Client, channel_id: str, body: str, **extra: Any)` (function)
- L202 `allow_policy(workspace_id: str, **fields: object)` (function) — Open a capability for a workspace, straight into the table.
- L243 `workspace_id_of(client: Client)` (function) — The workspace this client is signed into.
