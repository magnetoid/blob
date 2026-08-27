---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/admin_instance.py

Symbols in `apps/api/src/blob_api/routers/admin_instance.py`.

- L36 `OkOut` (class)
- L40 `InstanceUser` (class)
- L52 `InstanceUsersOut` (class)
- L56 `InstanceWorkspace` (class)
- L66 `InstanceWorkspacesOut` (class)
- L71 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L110 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L156 `CreateWorkspaceInput` (class)
- L160 `CreatedWorkspaceOut` (class)
- L167 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L205 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L224 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L234 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L248 `read_policy(workspace_id: str, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L262 `write_policy(workspace_id: str, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
- L298 `ServerLogEntry` (class)
- L310 `ServerLogsOut` (class)
- L318 `list_server_logs(level: str | None=None, limit: Annotated[int, Query(ge=1, le=500)]=100, _admin: SessionUser=Depends(require_instance_admin))` (function) — Recent warnings and errors, newest first.
- L337 `clear_server_logs(request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Empty the buffer — "I have dealt with these", which is its only state.
