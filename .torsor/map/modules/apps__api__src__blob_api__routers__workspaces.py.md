---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:42'
updated: '2026-09-04T07:26:42'
---

# apps/api/src/blob_api/routers/workspaces.py

Symbols in `apps/api/src/blob_api/routers/workspaces.py`.

- L32 `WorkspaceMembership` (class) — One workspace this person can reach, and who they are inside it.
- L42 `MyWorkspacesOut` (class)
- L46 `SwitchedOut` (class)
- L52 `my_workspaces(user: SessionUser=Depends(current_user))` (function) — Every workspace this address has a live account in.
- L72 `switch_workspace(workspace_id: IdParam, request: Request, response: Response, user: SessionUser=Depends(current_user))` (function) — Swap this browser's session to the account this person holds in another workspace.
