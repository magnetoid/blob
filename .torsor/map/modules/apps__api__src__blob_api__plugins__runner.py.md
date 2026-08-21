---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:44:31'
updated: '2026-08-21T06:44:31'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L29 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L37 `AgentRunner` (class)
- L38 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L42 `redeploy(self, deployment_id: str)` (method)
- L44 `status(self, deployment_id: str)` (method)
- L46 `stop(self, deployment_id: str)` (method)
- L49 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L56 `__init__(self)` (method)
- L60 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L98 `redeploy(self, deployment_id: str)` (method)
- L102 `status(self, deployment_id: str)` (method)
- L110 `stop(self, deployment_id: str)` (method)
- L113 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L134 `current_runner()` (function) — The configured runner, or a clear refusal.
