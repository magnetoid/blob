---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/src/blob_api/routers/plugin_hosting.py

Symbols in `apps/api/src/blob_api/routers/plugin_hosting.py`.

- L35 `RepoInput` (class)
- L43 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L57 `DeploymentOut` (class)
- L63 `LogsOut` (class)
- L67 `EnvVarOut` (class)
- L82 `EnvOut` (class)
- L89 `EnvInput` (class)
- L98 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L117 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L153 `deployment_status(plugin_id: IdParam, admin: SessionUser=Depends(require_admin))` (function)
- L161 `redeploy(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L169 `deployment_logs(plugin_id: IdParam, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L179 `stop_agent(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L193 `_env_out(values: list[runner.EnvVar])` (function)
- L214 `_hint(value: str)` (function) — Enough of a secret to recognise it, never enough to use it.
- L222 `agent_env(plugin_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — What a hosted agent is configured with.
- L235 `update_agent_env(plugin_id: IdParam, payload: EnvInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
