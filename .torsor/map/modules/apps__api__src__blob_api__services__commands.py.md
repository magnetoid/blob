---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/src/blob_api/services/commands.py

Symbols in `apps/api/src/blob_api/services/commands.py`.

- L60 `CommandContext` (class)
- L71 `CommandResult` (class) — What happened, for the router to broadcast.
- L121 `Command` (class)
- L131 `_help(ctx: CommandContext)` (function)
- L136 `_shrug(ctx: CommandContext)` (function)
- L149 `_me(ctx: CommandContext)` (function) — Post an action.
- L171 `_topic(ctx: CommandContext)` (function)
- L190 `_matches_handle(text: str, handle: str)` (function) — How many characters of `text` this handle consumes, or 0.
- L207 `_resolve_people(ctx: CommandContext)` (function) — The people the *leading* run of `@name`s names, and the words after them.
- L271 `_nobody(ctx: CommandContext, verb: str)` (function)
- L277 `_invite(ctx: CommandContext)` (function) — Slack's `/invite @person`, which is how most people add somebody to a channel.
- L301 `_agent_owner_and_bot(ctx: CommandContext, user_ids: list[str])` (function) — Split `@agent @person…` into the agent's plugin and the rest, or say what is wrong.
- L331 `_allow(ctx: CommandContext)` (function) — Let somebody else command your agent in this channel.
- L377 `_disallow(ctx: CommandContext)` (function) — Take back what `/allow` gave.
- L408 `_remove(ctx: CommandContext)` (function) — Slack calls it `/remove`, and `/kick` is the alias everybody actually types.
- L435 `_join(ctx: CommandContext)` (function) — `/join #general` — by name, because that is what somebody knows a channel by.
- L470 `_rename(ctx: CommandContext)` (function)
- L503 `_mute(ctx: CommandContext)` (function) — Toggle, like `/away`, because that is what the word means when you type it.
- L541 `_archive(ctx: CommandContext)` (function) — Archive this channel — admins only, and there is no way back.
- L566 `_who(ctx: CommandContext)` (function) — Who is in this channel — the question the members button answers in two clicks.
- L591 `_dm(ctx: CommandContext)` (function) — `/dm @Ana are you free?` — open the conversation, and say the thing if one is given.
- L646 `_remind(ctx: CommandContext)` (function) — `/remind me to water the plants tomorrow at 9`.
- L661 `_status(ctx: CommandContext)` (function) — `/status :palm_tree: on holiday`, and `/status clear` to take it down.
- L697 `_split_status(args: str)` (function) — A leading `:shortcode:` is the emoji; the rest is the words.
- L706 `_leave(ctx: CommandContext)` (function)
- L717 `_away(ctx: CommandContext)` (function) — Flip presence.
- L757 `AppCommand` (class) — An installed app's command, with everything needed to ask it.
- L767 `find_app_command(session: AsyncSession, workspace_id: str, name: str)` (function) — The app that holds this name, if one does and is enabled.
- L807 `app_specs(session: AsyncSession, workspace_id: str, actor_id: str)` (function) — (name, usage, summary) for every app command this person can actually run.
- L843 `bot_is_member(session: AsyncSession, channel_id: str, bot_user_id: str)` (function) — Whether an app has been added to this channel.
- L864 `bot_for_plugin(session: AsyncSession, plugin_id: str)` (function) — (bot user id, workspace id) for an installed, enabled app.
- L882 `builtin_names()` (function) — Names an app may not claim.
- L891 `ordered()` (function) — Commands for `/help`, alphabetically — the order a reader can predict.
- L896 `parse(text_input: str)` (function) — Split `/name rest` into its parts, or None when this is not a command at all.
- L913 `run(ctx: CommandContext, name: str)` (function)
