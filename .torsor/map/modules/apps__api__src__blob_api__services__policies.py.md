---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/src/blob_api/services/policies.py

Symbols in `apps/api/src/blob_api/services/policies.py`.

- L45 `Policy` (class) — What this workspace may actually do, environment included.
- L55 `_row_to_policy(row: Any)` (function)
- L65 `stored_for(session: AsyncSession, workspace_id: str)` (function) — What is written down, before the environment has its say.
- L89 `effective_for(session: AsyncSession, workspace_id: str)` (function) — Policy narrowed by what the server permits at all. What every guard asks.
- L105 `write(session: AsyncSession, *, workspace_id: str, actor_id: str | None, **fields: Any)` (function) — Set a workspace's policy. Upsert, because a workspace may have no row yet.
- L160 `app_count(session: AsyncSession, workspace_id: str)` (function)
- L173 `refuse_hosting()` (function)
- L181 `refuse_private_endpoint()` (function)
- L189 `refuse_socket_agent()` (function)
- L197 `refuse_scopes(scopes: list[str])` (function)
- L205 `refuse_app_limit(limit: int)` (function)
