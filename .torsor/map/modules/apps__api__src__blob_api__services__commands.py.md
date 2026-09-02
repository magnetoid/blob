---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:26:06'
updated: '2026-09-02T04:26:06'
---

# apps/api/src/blob_api/services/commands.py

Symbols in `apps/api/src/blob_api/services/commands.py`.

- L42 `CommandContext` (class)
- L53 `CommandResult` (class) — What happened, for the router to broadcast.
- L76 `Command` (class)
- L86 `_help(ctx: CommandContext)` (function)
- L91 `_shrug(ctx: CommandContext)` (function)
- L104 `_me(ctx: CommandContext)` (function) — Post an action.
- L126 `_topic(ctx: CommandContext)` (function)
- L145 `_leave(ctx: CommandContext)` (function)
- L156 `_away(ctx: CommandContext)` (function) — Flip presence.
- L184 `AppCommand` (class) — An installed app's command, with everything needed to ask it.
- L194 `find_app_command(session: AsyncSession, workspace_id: str, name: str)` (function) — The app that holds this name, if one does and is enabled.
- L234 `app_specs(session: AsyncSession, workspace_id: str)` (function) — (name, usage, summary) for every app command, for the composer's list.
- L253 `bot_is_member(session: AsyncSession, channel_id: str, bot_user_id: str)` (function) — Whether an app has been added to this channel.
- L274 `bot_for_plugin(session: AsyncSession, plugin_id: str)` (function) — (bot user id, workspace id) for an installed, enabled app.
- L292 `builtin_names()` (function) — Names an app may not claim.
- L301 `ordered()` (function) — Commands for `/help`, alphabetically — the order a reader can predict.
- L306 `parse(text_input: str)` (function) — Split `/name rest` into its parts, or None when this is not a command at all.
- L323 `run(ctx: CommandContext, name: str)` (function)
