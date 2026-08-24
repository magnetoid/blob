---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T16:51:20'
updated: '2026-08-24T16:51:20'
---

# apps/api/src/blob_api/routers/workspaces.py

Symbols in `apps/api/src/blob_api/routers/workspaces.py`.

- L31 `WorkspaceMembership` (class) — One workspace this person can reach, and who they are inside it.
- L41 `MyWorkspacesOut` (class)
- L45 `SwitchedOut` (class)
- L51 `my_workspaces(user: SessionUser=Depends(current_user))` (function) — Every workspace this address has a live account in.
- L71 `switch_workspace(workspace_id: str, request: Request, response: Response, user: SessionUser=Depends(current_user))` (function) — Swap this browser's session to the account this person holds in another workspace.
