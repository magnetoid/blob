---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/routers/plugin_hosting.py

Symbols in `apps/api/src/blob_api/routers/plugin_hosting.py`.

- L34 `RepoInput` (class)
- L42 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L56 `DeploymentOut` (class)
- L62 `LogsOut` (class)
- L66 `EnvVarOut` (class)
- L81 `EnvOut` (class)
- L88 `EnvInput` (class)
- L97 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L116 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L152 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L160 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L168 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L178 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L192 `_env_out(values: list[runner.EnvVar])` (function)
- L213 `_hint(value: str)` (function) — Enough of a secret to recognise it, never enough to use it.
- L221 `agent_env(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — What a hosted agent is configured with.
- L234 `update_agent_env(plugin_id: str, payload: EnvInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
