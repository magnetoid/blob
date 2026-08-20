---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/routers/bot_api.py

Symbols in `apps/api/src/blob_api/routers/bot_api.py`.

- L42 `AuthTestOut` (class)
- L51 `PostMessageInput` (class)
- L62 `MessageOut` (class)
- L67 `EditMessageInput` (class)
- L72 `DeleteMessageInput` (class)
- L76 `ReactionInput` (class)
- L81 `JoinInput` (class)
- L85 `OkOut` (class)
- L89 `ChannelsOut` (class)
- L94 `UsersOut` (class)
- L99 `_resolve_channel(session: Any, workspace_id: str, reference: str)` (function) — Accept either an id or a #name.
- L126 `auth_test(bot: BotCaller=Depends(current_bot))` (function) — Confirms a token works and says what it can do. The first call anyone makes.
- L138 `post_message(payload: PostMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L186 `update_message(payload: EditMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L226 `delete_message(payload: DeleteMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L271 `add_reaction(payload: ReactionInput, bot: BotCaller=requires('reactions:write'))` (function)
- L304 `list_conversations(limit: Annotated[int, Query(ge=1, le=200)]=100, bot: BotCaller=requires('channels:read'))` (function) — Channels this app can see: public ones, plus private ones it was invited to.
- L332 `join_conversation(payload: JoinInput, bot: BotCaller=requires('channels:join'))` (function)
- L353 `list_users(bot: BotCaller=requires('users:read'))` (function)
