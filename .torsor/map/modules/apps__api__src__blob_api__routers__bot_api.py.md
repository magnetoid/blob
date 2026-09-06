---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/routers/bot_api.py

Symbols in `apps/api/src/blob_api/routers/bot_api.py`.

- L50 `AuthTestOut` (class)
- L59 `PostMessageInput` (class)
- L73 `MessageOut` (class)
- L78 `EditMessageInput` (class)
- L83 `DeleteMessageInput` (class)
- L87 `ReactionInput` (class)
- L92 `JoinInput` (class)
- L96 `OkOut` (class)
- L100 `ChannelsOut` (class)
- L105 `UsersOut` (class)
- L110 `ThreadSummaryOut` (class)
- L115 `AgentTaskOut` (class)
- L120 `AgentTasksOut` (class)
- L125 `_resolve_channel(session: Any, workspace_id: str, reference: str)` (function) — Accept either an id or a #name.
- L151 `_bot_actor(bot: BotCaller)` (function)
- L156 `auth_test(bot: BotCaller=Depends(current_bot))` (function) — Confirms a token works and says what it can do. The first call anyone makes.
- L168 `post_message(payload: PostMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L226 `update_message(payload: EditMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L273 `delete_message(payload: DeleteMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L324 `PublishArtifactInput` (class)
- L331 `ArtifactOut` (class)
- L336 `publish_artifact(payload: PublishArtifactInput, bot: BotCaller=requires('messages:write'))` (function) — Put a diff, a page or a document into the work channel the bot is in (ADR 0014).
- L383 `add_reaction(payload: ReactionInput, bot: BotCaller=requires('reactions:write'))` (function)
- L424 `list_conversations(limit: Annotated[int, Query(ge=1, le=200)]=100, bot: BotCaller=requires('channels:read'))` (function) — Channels this app can see: public ones, plus private ones it was invited to.
- L452 `join_conversation(payload: JoinInput, bot: BotCaller=requires('channels:join'))` (function)
- L482 `summarize_thread(payload: DeleteMessageInput, bot: BotCaller=requires('summaries:write'))` (function)
- L527 `create_task(thread_root_id: IdParam, payload: CreateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L572 `update_task(task_id: str, payload: UpdateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L615 `list_tasks(thread_root_id: IdParam | None=None, bot: BotCaller=requires('tasks:read'))` (function)
- L648 `list_users(bot: BotCaller=requires('users:read'))` (function)
