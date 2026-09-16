---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/my_agents.py

Symbols in `apps/api/src/blob_api/routers/my_agents.py`.

- L56 `MyAgentOut` (class)
- L68 `MyAgentsOut` (class)
- L72 `AttachInput` (class)
- L76 `AttachedOut` (class)
- L84 `AgentChannel` (class)
- L91 `AgentChannelsOut` (class)
- L96 `bridge_source(_user: SessionUser=Depends(current_user))` (function) — The bridge script, for anybody with an agent to connect.
- L107 `WorkspaceAgentOut` (class)
- L116 `WorkspaceAgentsOut` (class)
- L121 `list_available(user: SessionUser=Depends(current_user))` (function) — The agents this person may bring into a piece of work: the workspace's, and theirs.
- L145 `list_mine(user: SessionUser=Depends(current_user))` (function)
- L152 `attach(payload: AttachInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Register an agent that is yours, and get the token it dials in with.
- L216 `detach(agent_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Remove your agent. Everything it said stays; its bot is retired the way any app's is.
- L235 `agent_channels(agent_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Where your agent could be, and where it is.
- L256 `agent_join_channel(agent_id: IdParam, channel_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L285 `agent_leave_channel(agent_id: IdParam, channel_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L311 `_out(row: Any)` (function)
