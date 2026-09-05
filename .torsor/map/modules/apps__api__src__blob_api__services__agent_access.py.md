---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/services/agent_access.py

Symbols in `apps/api/src/blob_api/services/agent_access.py`.

- L22 `commandable_by(session: AsyncSession, *, workspace_id: str, actor_id: str, channel_id: str, bot_user_ids: list[str])` (function) — Which of these agents `actor_id` may set going in this channel.
- L75 `grant(session: AsyncSession, *, workspace_id: str, plugin_id: str, grantee_user_id: str, granted_by: str, channel_id: str | None)` (function) — Let somebody command this agent — here, or anywhere.
- L110 `revoke(session: AsyncSession, *, plugin_id: str, grantee_user_id: str, channel_id: str | None)` (function) — Take it back. Answers how many grants that ended, so the caller can say so.
- L143 `listeners(session: AsyncSession, *, plugin_id: str, channel_id: str | None)` (function) — (display name, channel id) for everyone who may command this agent, by grant.
