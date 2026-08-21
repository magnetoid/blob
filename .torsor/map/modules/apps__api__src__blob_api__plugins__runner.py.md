---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T20:16:22'
updated: '2026-08-21T20:16:22'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L35 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L43 `AgentRunner` (class)
- L44 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L48 `redeploy(self, deployment_id: str)` (method)
- L50 `status(self, deployment_id: str)` (method)
- L52 `logs(self, deployment_id: str, lines: int)` (method)
- L54 `stop(self, deployment_id: str)` (method)
- L57 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L64 `__init__(self)` (method)
- L68 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L110 `redeploy(self, deployment_id: str)` (method)
- L114 `status(self, deployment_id: str)` (method)
- L122 `logs(self, deployment_id: str, lines: int=200)` (method) — Whatever the container has written lately.
- L136 `stop(self, deployment_id: str)` (method)
- L139 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L160 `current_runner()` (function) — The configured runner, or a clear refusal.
