---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:43'
updated: '2026-09-04T07:26:43'
---

# apps/api/src/blob_api/services/commands.py

Symbols in `apps/api/src/blob_api/services/commands.py`.

- L59 `CommandContext` (class)
- L70 `CommandResult` (class) — What happened, for the router to broadcast.
- L120 `Command` (class)
- L130 `_help(ctx: CommandContext)` (function)
- L135 `_shrug(ctx: CommandContext)` (function)
- L148 `_me(ctx: CommandContext)` (function) — Post an action.
- L170 `_topic(ctx: CommandContext)` (function)
- L189 `_matches_handle(text: str, handle: str)` (function) — How many characters of `text` this handle consumes, or 0.
- L206 `_resolve_people(ctx: CommandContext)` (function) — The people the *leading* run of `@name`s names, and the words after them.
- L270 `_nobody(ctx: CommandContext, verb: str)` (function)
- L276 `_invite(ctx: CommandContext)` (function) — Slack's `/invite @person`, which is how most people add somebody to a channel.
- L300 `_remove(ctx: CommandContext)` (function) — Slack calls it `/remove`, and `/kick` is the alias everybody actually types.
- L327 `_join(ctx: CommandContext)` (function) — `/join #general` — by name, because that is what somebody knows a channel by.
- L362 `_rename(ctx: CommandContext)` (function)
- L395 `_mute(ctx: CommandContext)` (function) — Toggle, like `/away`, because that is what the word means when you type it.
- L433 `_archive(ctx: CommandContext)` (function) — Archive this channel — admins only, and there is no way back.
- L458 `_who(ctx: CommandContext)` (function) — Who is in this channel — the question the members button answers in two clicks.
- L483 `_dm(ctx: CommandContext)` (function) — `/dm @Ana are you free?` — open the conversation, and say the thing if one is given.
- L538 `_remind(ctx: CommandContext)` (function) — `/remind me to water the plants tomorrow at 9`.
- L553 `_status(ctx: CommandContext)` (function) — `/status :palm_tree: on holiday`, and `/status clear` to take it down.
- L589 `_split_status(args: str)` (function) — A leading `:shortcode:` is the emoji; the rest is the words.
- L598 `_leave(ctx: CommandContext)` (function)
- L609 `_away(ctx: CommandContext)` (function) — Flip presence.
- L647 `AppCommand` (class) — An installed app's command, with everything needed to ask it.
- L657 `find_app_command(session: AsyncSession, workspace_id: str, name: str)` (function) — The app that holds this name, if one does and is enabled.
- L697 `app_specs(session: AsyncSession, workspace_id: str)` (function) — (name, usage, summary) for every app command, for the composer's list.
- L716 `bot_is_member(session: AsyncSession, channel_id: str, bot_user_id: str)` (function) — Whether an app has been added to this channel.
- L737 `bot_for_plugin(session: AsyncSession, plugin_id: str)` (function) — (bot user id, workspace id) for an installed, enabled app.
- L755 `builtin_names()` (function) — Names an app may not claim.
- L764 `ordered()` (function) — Commands for `/help`, alphabetically — the order a reader can predict.
- L769 `parse(text_input: str)` (function) — Split `/name rest` into its parts, or None when this is not a command at all.
- L786 `run(ctx: CommandContext, name: str)` (function)
