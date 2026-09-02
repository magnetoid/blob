---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T03:28:21'
updated: '2026-09-02T03:28:21'
---

# apps/api/src/blob_api/plugins/registry.py

Symbols in `apps/api/src/blob_api/plugins/registry.py`.

- L37 `Installed` (class)
- L45 `bot_email(slug: str)` (function)
- L49 `by_id(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L61 `granted_scopes(session: AsyncSession, plugin_id: str)` (function)
- L71 `install(session: AsyncSession, *, workspace_id: str, manifest: Manifest, installed_by: str, source_repo: str | None=None, source_ref: str | None=None, reserved_commands: frozenset[str]=frozenset(), trusted: bool=False)` (function)
- L154 `_create_bot_user(session: AsyncSession, workspace_id: str, plugin_id: str, manifest: Manifest)` (function) — A real user row, with no password so it can never sign in through the front door.
- L182 `_available_display_name(session: AsyncSession, workspace_id: str, wanted: str)` (function) — Find a mentionable name this bot can have, suffixing until one is free.
- L202 `_write_grants(session: AsyncSession, plugin_id: str, scopes: list[str], granted_by: str | None)` (function)
- L218 `_write_commands(session: AsyncSession, *, plugin_id: str, workspace_id: str, commands: list[CommandDecl])` (function) — Replace this app's commands with what its manifest now declares.
- L266 `mint_token(session: AsyncSession, plugin_id: str)` (function) — A bearer token for the callback API. Only its hash is stored.
- L276 `update(session: AsyncSession, *, plugin_id: str, workspace_id: str, manifest: Manifest, actor_id: str, reserved_commands: frozenset[str]=frozenset())` (function) — Apply a new manifest. Returns scopes that need approval before events resume.
- L353 `describe(session: AsyncSession, *, plugin_id: str, workspace_id: str, name: str | None=None, description: str | None=None, version: str | None=None)` (function) — Record what a socket agent says it is, on the way in.
- L390 `approve(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Accept an update's widened scopes and let the app run again.
- L408 `decline_scopes(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Refuse an update's widened scopes; the app runs on with what it had.
- L442 `set_budget(session: AsyncSession, plugin_id: str, workspace_id: str, *, runs_per_day: int | None, seconds_per_day: int | None)` (function) — Cap what this agent may spend in a trailing day. NULL lifts the cap.
- L469 `set_status(session: AsyncSession, plugin_id: str, workspace_id: str, status: Status)` (function)
- L479 `rotate_secret(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L495 `uninstall(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Remove the app and retire its bot, keeping everything the bot ever said.
- L512 `bot_user_id(session: AsyncSession, plugin_id: str)` (function)
