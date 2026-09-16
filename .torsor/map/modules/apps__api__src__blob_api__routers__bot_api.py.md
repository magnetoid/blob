---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/bot_api.py

Symbols in `apps/api/src/blob_api/routers/bot_api.py`.

- L51 `AuthTestOut` (class)
- L60 `PostMessageInput` (class)
- L74 `MessageOut` (class)
- L79 `EditMessageInput` (class)
- L84 `DeleteMessageInput` (class)
- L88 `ReactionInput` (class)
- L93 `JoinInput` (class)
- L97 `ChannelsOut` (class)
- L102 `UsersOut` (class)
- L107 `ThreadSummaryOut` (class)
- L112 `AgentTaskOut` (class)
- L117 `AgentTasksOut` (class)
- L122 `_resolve_channel(session: Any, workspace_id: str, reference: str, bot_user_id: str)` (function) — Accept either an id or a #name, resolved as the bot itself.
- L138 `_bot_actor(bot: BotCaller)` (function)
- L143 `auth_test(bot: BotCaller=Depends(current_bot))` (function) — Confirms a token works and says what it can do. The first call anyone makes.
- L155 `post_message(payload: PostMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L213 `update_message(payload: EditMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L257 `delete_message(payload: DeleteMessageInput, bot: BotCaller=requires('messages:write'))` (function)
- L305 `PublishArtifactInput` (class)
- L312 `ArtifactOut` (class)
- L317 `publish_artifact(payload: PublishArtifactInput, bot: BotCaller=requires('messages:write'))` (function) — Put a diff, a page or a document into the work channel the bot is in (ADR 0014).
- L364 `add_reaction(payload: ReactionInput, bot: BotCaller=requires('reactions:write'))` (function)
- L403 `list_conversations(limit: Annotated[int, Query(ge=1, le=200)]=100, bot: BotCaller=requires('channels:read'))` (function) — Channels this app can see: public ones, plus private ones it was invited to.
- L416 `join_conversation(payload: JoinInput, bot: BotCaller=requires('channels:join'))` (function)
- L446 `summarize_thread(payload: DeleteMessageInput, bot: BotCaller=requires('summaries:write'))` (function)
- L490 `create_task(thread_root_id: IdParam, payload: CreateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L534 `update_task(task_id: str, payload: UpdateAgentTaskInput, bot: BotCaller=requires('tasks:write'))` (function)
- L577 `list_tasks(thread_root_id: IdParam | None=None, bot: BotCaller=requires('tasks:read'))` (function)
- L597 `list_users(bot: BotCaller=requires('users:read'))` (function)
