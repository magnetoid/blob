---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/plugins/registry.py

Symbols in `apps/api/src/blob_api/plugins/registry.py`.

- L44 `Installed` (class)
- L52 `bot_email(slug: str)` (function)
- L56 `by_id(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L68 `granted_scopes(session: AsyncSession, plugin_id: str)` (function)
- L78 `install(session: AsyncSession, *, workspace_id: str, manifest: Manifest, installed_by: str, source_repo: str | None=None, source_ref: str | None=None, reserved_commands: frozenset[str]=frozenset(), signing_secret: str | None=None, in_every_public_channel: bool=False, answers_dm_without_mention: bool=False)` (function)
- L172 `_create_bot_user(session: AsyncSession, workspace_id: str, plugin_id: str, manifest: Manifest)` (function) — A real user row, with no password so it can never sign in through the front door.
- L200 `_available_display_name(session: AsyncSession, workspace_id: str, wanted: str)` (function) — Find a mentionable name this bot can have, suffixing until one is free.
- L220 `_write_grants(session: AsyncSession, plugin_id: str, scopes: list[str], granted_by: str | None)` (function)
- L236 `_write_commands(session: AsyncSession, *, plugin_id: str, workspace_id: str, commands: list[CommandDecl])` (function) — Replace this app's commands with what its manifest now declares.
- L284 `mint_token(session: AsyncSession, plugin_id: str)` (function) — A bearer token for the callback API. Only its hash is stored.
- L294 `update(session: AsyncSession, *, plugin_id: str, workspace_id: str, manifest: Manifest, actor_id: str, reserved_commands: frozenset[str]=frozenset())` (function) — Apply a new manifest. Returns scopes that need approval before events resume.
- L376 `_within(value: str | None, limit: int)` (function) — The value if it is a usable string of the right size, else nothing.
- L384 `describe(session: AsyncSession, *, plugin_id: str, workspace_id: str, name: str | None=None, description: str | None=None, version: str | None=None)` (function) — Record what a socket agent says it is, on the way in.
- L437 `approve(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Accept an update's widened scopes and let the app run again.
- L455 `decline_scopes(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Refuse an update's widened scopes; the app runs on with what it had.
- L489 `set_budget(session: AsyncSession, plugin_id: str, workspace_id: str, *, runs_per_day: int | None, seconds_per_day: int | None)` (function) — Cap what this agent may spend in a trailing day. NULL lifts the cap.
- L516 `set_status(session: AsyncSession, plugin_id: str, workspace_id: str, status: Status)` (function)
- L533 `rotate_secret(session: AsyncSession, plugin_id: str, workspace_id: str)` (function)
- L549 `uninstall(session: AsyncSession, plugin_id: str, workspace_id: str)` (function) — Remove the app and retire its bot, keeping everything the bot ever said.
- L590 `bot_user_id(session: AsyncSession, plugin_id: str)` (function)
- L599 `list_for_workspace(session: AsyncSession, workspace_id: str)` (function)
- L610 `listing_details(session: AsyncSession, plugin_ids: list[str])` (function) — Scopes, delivery counts, bot ids and channel counts for a page of plugins.
- L684 `set_owner(session: AsyncSession, plugin_id: str, workspace_id: str, user_id: str | None)` (function) — Who an agent answers: one live person in this workspace, or everybody.
- L709 `revoke_tokens(session: AsyncSession, plugin_id: str)` (function)
- L727 `deliveries(session: AsyncSession, plugin_id: str, *, limit: int)` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L747 `delivery(session: AsyncSession, plugin_id: str, delivery_id: str)` (function) — One delivery in full, including the payload the app was sent.
- L766 `replay_delivery(session: AsyncSession, plugin_id: str, delivery_id: str)` (function) — Put a failed or dead delivery back in the queue, as if it had never been tried.
- L796 `public_channels_for_bot(session: AsyncSession, workspace_id: str, bot_user_id: str | None)` (function) — Every public channel, with whether this bot is already in it.
