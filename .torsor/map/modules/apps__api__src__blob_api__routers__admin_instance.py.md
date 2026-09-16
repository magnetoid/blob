---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T02:35:20'
updated: '2026-09-16T02:35:20'
---

# apps/api/src/blob_api/routers/admin_instance.py

Symbols in `apps/api/src/blob_api/routers/admin_instance.py`.

- L37 `InstanceUser` (class)
- L49 `InstanceUsersOut` (class)
- L53 `InstanceWorkspace` (class)
- L63 `InstanceWorkspacesOut` (class)
- L68 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L94 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L122 `CreateWorkspaceInput` (class)
- L126 `CreatedWorkspaceOut` (class)
- L133 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L171 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L195 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L206 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L222 `read_policy(workspace_id: IdParam, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L236 `write_policy(workspace_id: IdParam, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
- L272 `ServerLogEntry` (class)
- L284 `ServerLogsOut` (class)
- L292 `list_server_logs(level: str | None=None, limit: Annotated[int, Query(ge=1, le=500)]=100, _admin: SessionUser=Depends(require_instance_admin))` (function) — Recent warnings and errors, newest first.
- L311 `clear_server_logs(request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Empty the buffer — "I have dealt with these", which is its only state.
