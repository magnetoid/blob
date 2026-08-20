---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/plugins/registry.py

Symbols in `apps/api/src/blob_api/plugins/registry.py`.

- L35 `Installed` (class)
- L43 `bot_email(slug: str)` (function)
- L47 `by_id(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L59 `granted_scopes(session: AsyncSession, plugin_id: str)` (function)
- L69 `install(session: AsyncSession, *, workspace_id: str, manifest: Manifest, installed_by: str)` (function)
- L131 `_create_bot_user(session: AsyncSession, workspace_id: str, plugin_id: str, manifest: Manifest)` (function) — A real user row, with no password so it can never sign in through the front door.
- L156 `_available_display_name(session: AsyncSession, workspace_id: str, wanted: str)` (function) — Mentions resolve by display name, and the unique index is partial on active users.
- L183 `_write_grants(session: AsyncSession, plugin_id: str, scopes: list[str], granted_by: str | None)` (function)
- L199 `mint_token(session: AsyncSession, plugin_id: str)` (function) — A bearer token for the callback API. Only its hash is stored.
- L209 `update(session: AsyncSession, *, plugin_id: str, workspace_id: str, manifest: Manifest, actor_id: str)` (function) — Apply a new manifest. Returns scopes that need approval before events resume.
- L264 `approve(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Accept an update's widened scopes and let the app run again.
- L272 `set_status(session: AsyncSession, plugin_id: str, workspace_id: str, status: Status)` (function)
- L282 `rotate_secret(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L298 `uninstall(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Remove the app and retire its bot, keeping everything the bot ever said.
- L315 `bot_user_id(session: AsyncSession, plugin_id: str)` (function)
