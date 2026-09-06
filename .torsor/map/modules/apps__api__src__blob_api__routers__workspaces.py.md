---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-07T00:07:27'
updated: '2026-09-07T00:07:27'
---

# apps/api/src/blob_api/routers/workspaces.py

Symbols in `apps/api/src/blob_api/routers/workspaces.py`.

- L33 `WorkspaceMembership` (class) — One workspace this person can reach, and who they are inside it.
- L43 `MyWorkspacesOut` (class)
- L47 `SwitchedOut` (class)
- L53 `my_workspaces(user: SessionUser=Depends(current_user))` (function) — Every workspace this address has a live account in.
- L73 `switch_workspace(workspace_id: IdParam, request: Request, response: Response, user: SessionUser=Depends(current_user))` (function) — Swap this browser's session to the account this person holds in another workspace.
