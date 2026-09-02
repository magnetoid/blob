---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T06:12:04'
updated: '2026-09-02T06:12:04'
---

# apps/api/src/blob_api/routers/admin_instance.py

Symbols in `apps/api/src/blob_api/routers/admin_instance.py`.

- L37 `OkOut` (class)
- L41 `InstanceUser` (class)
- L53 `InstanceUsersOut` (class)
- L57 `InstanceWorkspace` (class)
- L67 `InstanceWorkspacesOut` (class)
- L72 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L111 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L157 `CreateWorkspaceInput` (class)
- L161 `CreatedWorkspaceOut` (class)
- L168 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L206 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L225 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L235 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L249 `read_policy(workspace_id: IdParam, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L263 `write_policy(workspace_id: IdParam, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
- L299 `ServerLogEntry` (class)
- L311 `ServerLogsOut` (class)
- L319 `list_server_logs(level: str | None=None, limit: Annotated[int, Query(ge=1, le=500)]=100, _admin: SessionUser=Depends(require_instance_admin))` (function) — Recent warnings and errors, newest first.
- L338 `clear_server_logs(request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Empty the buffer — "I have dealt with these", which is its only state.
