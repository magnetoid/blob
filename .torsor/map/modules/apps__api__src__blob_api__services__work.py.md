---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/services/work.py

Symbols in `apps/api/src/blob_api/services/work.py`.

- L54 `Work` (class)
- L68 `Artifact` (class)
- L80 `Started` (class)
- L95 `_work(row: Any)` (function)
- L111 `_artifact(row: Any)` (function)
- L124 `by_channel(session: AsyncSession, channel_id: str)` (function)
- L131 `get(session: AsyncSession, work_id: str, workspace_id: str)` (function)
- L143 `artifacts(session: AsyncSession, work_id: str)` (function)
- L158 `start(session: AsyncSession, after: Any, *, workspace_id: str, user_id: str, root_message_id: str, title: str, agent_plugin_ids: list[str], public_url: str)` (function) — Spin a channel for the assignment, seed it with where it came from, bring the agents.
- L298 `publish(session: AsyncSession, *, work_id: str, kind: str, title: str, body: str, author_user_id: str | None, run_id: str | None=None)` (function) — Put something made into the work. Validated here, whoever made it.
- L356 `finish(session: AsyncSession, *, work_id: str, workspace_id: str, user_id: str, is_admin: bool)` (function) — Mark the assignment done and archive its channel.
- L386 `_bots_for(session: AsyncSession, workspace_id: str, user_id: str, plugin_ids: list[str])` (function) — The agents to bring, as (plugin, bot user, name). Refuses one the starter may not command.
- L427 `_free_name(session: AsyncSession, workspace_id: str, base: str)` (function)
