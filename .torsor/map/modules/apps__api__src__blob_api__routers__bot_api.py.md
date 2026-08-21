---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:40:59'
updated: '2026-08-21T06:40:59'
---

# apps/api/src/blob_api/routers/bot_api.py

Symbols in `apps/api/src/blob_api/routers/bot_api.py`.

- L45 `AuthTestOut` (class)
- L54 `PostMessageInput` (class)
- L65 `MessageOut` (class)
- L70 `EditMessageInput` (class)
- L75 `DeleteMessageInput` (class)
- L79 `ReactionInput` (class)
- L84 `JoinInput` (class)
- L88 `OkOut` (class)
- L92 `ChannelsOut` (class)
- L97 `UsersOut` (class)
- L102 `ThreadSummaryOut` (class)
- L107 `AgentTaskOut` (class)
- L112 `AgentTasksOut` (class)
- L117 `_resolve_channel(session: Any, workspace_id: str, reference: str)` (function) — Accept either an id or a #name.
- L143 `_bot_actor(bot: BotCaller)` (function)
- L148 `auth_test(bot: BotCaller=Depends(current_bot))` (function) — Confirms a token works and says what it can do. The first call anyone makes.
- L160 `post_message(payload: PostMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L216 `update_message(payload: EditMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L264 `delete_message(payload: DeleteMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L317 `add_reaction(payload: ReactionInput, bot: BotCaller=requires('reactions:write'))` (function)
- L358 `list_conversations(limit: Annotated[int, Query(ge=1, le=200)]=100, bot: BotCaller=requires('channels:read'))` (function) — Channels this app can see: public ones, plus private ones it was invited to.
- L386 `join_conversation(payload: JoinInput, bot: BotCaller=requires('channels:join'))` (function)
- L415 `summarize_thread(payload: DeleteMessageInput, bot: BotCaller=requires('summaries:write'))` (function)
- L450 `create_task(thread_root_id: str, payload: CreateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L494 `update_task(task_id: str, payload: UpdateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L536 `list_tasks(thread_root_id: str | None=None, bot: BotCaller=requires('tasks:read'))` (function)
- L569 `list_users(bot: BotCaller=requires('users:read'))` (function)
