---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:21:53'
updated: '2026-09-02T05:21:53'
---

# apps/api/src/blob_api/services/commands.py

Symbols in `apps/api/src/blob_api/services/commands.py`.

- L45 `CommandContext` (class)
- L56 `CommandResult` (class) — What happened, for the router to broadcast.
- L99 `Command` (class)
- L109 `_help(ctx: CommandContext)` (function)
- L114 `_shrug(ctx: CommandContext)` (function)
- L127 `_me(ctx: CommandContext)` (function) — Post an action.
- L149 `_topic(ctx: CommandContext)` (function)
- L168 `_resolve_people(ctx: CommandContext)` (function) — `@Ana @designers` → the user ids that names.
- L214 `_nobody(ctx: CommandContext, verb: str)` (function)
- L220 `_invite(ctx: CommandContext)` (function) — Slack's `/invite @person`, which is how most people add somebody to a channel.
- L244 `_remove(ctx: CommandContext)` (function) — Slack calls it `/remove`, and `/kick` is the alias everybody actually types.
- L271 `_join(ctx: CommandContext)` (function) — `/join #general` — by name, because that is what somebody knows a channel by.
- L306 `_rename(ctx: CommandContext)` (function)
- L339 `_mute(ctx: CommandContext)` (function) — Toggle, like `/away`, because that is what the word means when you type it.
- L373 `_archive(ctx: CommandContext)` (function)
- L386 `_who(ctx: CommandContext)` (function) — Who is in this channel — the question the members button answers in two clicks.
- L411 `_dm(ctx: CommandContext)` (function) — `/dm @Ana are you free?` — open the conversation, and say the thing if one is given.
- L454 `_text_after_names(args: str, handles: list[str])` (function) — Everything after the run of leading `@name`s.
- L476 `_status(ctx: CommandContext)` (function) — `/status :palm_tree: on holiday`, and `/status clear` to take it down.
- L503 `_split_status(args: str)` (function) — A leading `:shortcode:` is the emoji; the rest is the words.
- L512 `_leave(ctx: CommandContext)` (function)
- L523 `_away(ctx: CommandContext)` (function) — Flip presence.
- L560 `AppCommand` (class) — An installed app's command, with everything needed to ask it.
- L570 `find_app_command(session: AsyncSession, workspace_id: str, name: str)` (function) — The app that holds this name, if one does and is enabled.
- L610 `app_specs(session: AsyncSession, workspace_id: str)` (function) — (name, usage, summary) for every app command, for the composer's list.
- L629 `bot_is_member(session: AsyncSession, channel_id: str, bot_user_id: str)` (function) — Whether an app has been added to this channel.
- L650 `bot_for_plugin(session: AsyncSession, plugin_id: str)` (function) — (bot user id, workspace id) for an installed, enabled app.
- L668 `builtin_names()` (function) — Names an app may not claim.
- L677 `ordered()` (function) — Commands for `/help`, alphabetically — the order a reader can predict.
- L682 `parse(text_input: str)` (function) — Split `/name rest` into its parts, or None when this is not a command at all.
- L699 `run(ctx: CommandContext, name: str)` (function)
