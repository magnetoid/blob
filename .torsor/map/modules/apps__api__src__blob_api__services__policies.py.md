---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/src/blob_api/services/policies.py

Symbols in `apps/api/src/blob_api/services/policies.py`.

- L46 `Policy` (class) — What this workspace may actually do, environment included.
- L59 `_row_to_policy(row: Any)` (function)
- L70 `stored_for(session: AsyncSession, workspace_id: str)` (function) — What is written down, before the environment has its say.
- L95 `effective_for(session: AsyncSession, workspace_id: str)` (function) — Policy narrowed by what the server permits at all. What every guard asks.
- L114 `write(session: AsyncSession, *, workspace_id: str, actor_id: str | None, **fields: Any)` (function) — Set a workspace's policy. Upsert, because a workspace may have no row yet.
- L174 `app_count(session: AsyncSession, workspace_id: str)` (function)
- L187 `refuse_hosting()` (function)
- L195 `refuse_private_endpoint()` (function)
- L203 `refuse_socket_agent()` (function)
- L211 `refuse_scopes(scopes: list[str])` (function)
- L219 `refuse_app_limit(limit: int)` (function)
