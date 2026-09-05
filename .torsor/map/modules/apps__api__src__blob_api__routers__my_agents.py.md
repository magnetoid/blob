---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/my_agents.py

Symbols in `apps/api/src/blob_api/routers/my_agents.py`.

- L57 `MyAgentOut` (class)
- L69 `MyAgentsOut` (class)
- L73 `AttachInput` (class)
- L77 `AttachedOut` (class)
- L85 `AgentChannel` (class)
- L92 `AgentChannelsOut` (class)
- L96 `OkOut` (class)
- L101 `bridge_source(_user: SessionUser=Depends(current_user))` (function) — The bridge script, for anybody with an agent to connect.
- L112 `WorkspaceAgentOut` (class)
- L121 `WorkspaceAgentsOut` (class)
- L126 `list_available(user: SessionUser=Depends(current_user))` (function) — The agents this person may bring into a piece of work: the workspace's, and theirs.
- L165 `list_mine(user: SessionUser=Depends(current_user))` (function)
- L186 `attach(payload: AttachInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Register an agent that is yours, and get the token it dials in with.
- L253 `detach(agent_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Remove your agent. Everything it said stays; its bot is retired the way any app's is.
- L272 `agent_channels(agent_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Where your agent could be, and where it is.
- L311 `agent_join_channel(agent_id: IdParam, channel_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L340 `agent_leave_channel(agent_id: IdParam, channel_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L366 `_mine(session: AsyncSession, user: SessionUser, agent_id: str)` (function) — The agent, if it is this person's. 404 otherwise — whose it is stays private.
- L387 `_free_slug(session: AsyncSession, workspace_id: str, base: str)` (function) — `base`, or the first `base-N` nobody holds. Slugs are per workspace and permanent.
- L407 `_out(row: Any)` (function)
