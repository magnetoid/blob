---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:51'
updated: '2026-09-01T22:51:51'
---

# apps/api/src/blob_api/routers/bot_api.py

Symbols in `apps/api/src/blob_api/routers/bot_api.py`.

- L46 `AuthTestOut` (class)
- L55 `PostMessageInput` (class)
- L69 `MessageOut` (class)
- L74 `EditMessageInput` (class)
- L79 `DeleteMessageInput` (class)
- L83 `ReactionInput` (class)
- L88 `JoinInput` (class)
- L92 `OkOut` (class)
- L96 `ChannelsOut` (class)
- L101 `UsersOut` (class)
- L106 `ThreadSummaryOut` (class)
- L111 `AgentTaskOut` (class)
- L116 `AgentTasksOut` (class)
- L121 `_resolve_channel(session: Any, workspace_id: str, reference: str)` (function) — Accept either an id or a #name.
- L147 `_bot_actor(bot: BotCaller)` (function)
- L152 `auth_test(bot: BotCaller=Depends(current_bot))` (function) — Confirms a token works and says what it can do. The first call anyone makes.
- L164 `post_message(payload: PostMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L222 `update_message(payload: EditMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L269 `delete_message(payload: DeleteMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L321 `add_reaction(payload: ReactionInput, bot: BotCaller=requires('reactions:write'))` (function)
- L362 `list_conversations(limit: Annotated[int, Query(ge=1, le=200)]=100, bot: BotCaller=requires('channels:read'))` (function) — Channels this app can see: public ones, plus private ones it was invited to.
- L390 `join_conversation(payload: JoinInput, bot: BotCaller=requires('channels:join'))` (function)
- L420 `summarize_thread(payload: DeleteMessageInput, bot: BotCaller=requires('summaries:write'))` (function)
- L456 `create_task(thread_root_id: IdParam, payload: CreateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L500 `update_task(task_id: str, payload: UpdateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L542 `list_tasks(thread_root_id: IdParam | None=None, bot: BotCaller=requires('tasks:read'))` (function)
- L575 `list_users(bot: BotCaller=requires('users:read'))` (function)
