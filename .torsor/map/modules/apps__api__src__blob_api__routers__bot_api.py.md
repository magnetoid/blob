---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/bot_api.py

Symbols in `apps/api/src/blob_api/routers/bot_api.py`.

- L48 `AuthTestOut` (class)
- L57 `PostMessageInput` (class)
- L71 `MessageOut` (class)
- L76 `EditMessageInput` (class)
- L81 `DeleteMessageInput` (class)
- L85 `ReactionInput` (class)
- L90 `JoinInput` (class)
- L94 `OkOut` (class)
- L98 `ChannelsOut` (class)
- L103 `UsersOut` (class)
- L108 `ThreadSummaryOut` (class)
- L113 `AgentTaskOut` (class)
- L118 `AgentTasksOut` (class)
- L123 `_resolve_channel(session: Any, workspace_id: str, reference: str)` (function) — Accept either an id or a #name.
- L149 `_bot_actor(bot: BotCaller)` (function)
- L154 `auth_test(bot: BotCaller=Depends(current_bot))` (function) — Confirms a token works and says what it can do. The first call anyone makes.
- L166 `post_message(payload: PostMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L224 `update_message(payload: EditMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L271 `delete_message(payload: DeleteMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L322 `PublishArtifactInput` (class)
- L329 `ArtifactOut` (class)
- L334 `publish_artifact(payload: PublishArtifactInput, bot: BotCaller=requires('messages:write'))` (function) — Put a diff, a page or a document into the work channel the bot is in (ADR 0014).
- L381 `add_reaction(payload: ReactionInput, bot: BotCaller=requires('reactions:write'))` (function)
- L422 `list_conversations(limit: Annotated[int, Query(ge=1, le=200)]=100, bot: BotCaller=requires('channels:read'))` (function) — Channels this app can see: public ones, plus private ones it was invited to.
- L450 `join_conversation(payload: JoinInput, bot: BotCaller=requires('channels:join'))` (function)
- L480 `summarize_thread(payload: DeleteMessageInput, bot: BotCaller=requires('summaries:write'))` (function)
- L516 `create_task(thread_root_id: IdParam, payload: CreateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L561 `update_task(task_id: str, payload: UpdateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L604 `list_tasks(thread_root_id: IdParam | None=None, bot: BotCaller=requires('tasks:read'))` (function)
- L637 `list_users(bot: BotCaller=requires('users:read'))` (function)
