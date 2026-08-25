---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T10:13:28'
updated: '2026-08-25T10:13:28'
---

# apps/api/src/blob_api/plugins/registry.py

Symbols in `apps/api/src/blob_api/plugins/registry.py`.

- L37 `Installed` (class)
- L45 `bot_email(slug: str)` (function)
- L49 `by_id(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L61 `granted_scopes(session: AsyncSession, plugin_id: str)` (function)
- L71 `install(session: AsyncSession, *, workspace_id: str, manifest: Manifest, installed_by: str, source_repo: str | None=None, source_ref: str | None=None, reserved_commands: frozenset[str]=frozenset())` (function)
- L151 `_create_bot_user(session: AsyncSession, workspace_id: str, plugin_id: str, manifest: Manifest)` (function) — A real user row, with no password so it can never sign in through the front door.
- L179 `_available_display_name(session: AsyncSession, workspace_id: str, wanted: str)` (function) — Find a mentionable name this bot can have, suffixing until one is free.
- L199 `_write_grants(session: AsyncSession, plugin_id: str, scopes: list[str], granted_by: str | None)` (function)
- L215 `_write_commands(session: AsyncSession, *, plugin_id: str, workspace_id: str, commands: list[CommandDecl])` (function) — Replace this app's commands with what its manifest now declares.
- L263 `commands_for(session: AsyncSession, workspace_id: str)` (function) — Every app command in the workspace, for the composer's list and for dispatch.
- L287 `mint_token(session: AsyncSession, plugin_id: str)` (function) — A bearer token for the callback API. Only its hash is stored.
- L297 `update(session: AsyncSession, *, plugin_id: str, workspace_id: str, manifest: Manifest, actor_id: str, reserved_commands: frozenset[str]=frozenset())` (function) — Apply a new manifest. Returns scopes that need approval before events resume.
- L361 `describe(session: AsyncSession, *, plugin_id: str, workspace_id: str, name: str | None=None, description: str | None=None, version: str | None=None)` (function) — Record what a socket agent says it is, on the way in.
- L398 `approve(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Accept an update's widened scopes and let the app run again.
- L406 `set_status(session: AsyncSession, plugin_id: str, workspace_id: str, status: Status)` (function)
- L416 `rotate_secret(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L432 `uninstall(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Remove the app and retire its bot, keeping everything the bot ever said.
- L449 `bot_user_id(session: AsyncSession, plugin_id: str)` (function)
