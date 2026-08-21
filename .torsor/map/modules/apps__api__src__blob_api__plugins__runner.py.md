---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:47:02'
updated: '2026-08-21T07:47:02'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L29 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L37 `AgentRunner` (class)
- L38 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L42 `redeploy(self, deployment_id: str)` (method)
- L44 `status(self, deployment_id: str)` (method)
- L46 `logs(self, deployment_id: str, lines: int)` (method)
- L48 `stop(self, deployment_id: str)` (method)
- L51 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L58 `__init__(self)` (method)
- L62 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L100 `redeploy(self, deployment_id: str)` (method)
- L104 `status(self, deployment_id: str)` (method)
- L112 `logs(self, deployment_id: str, lines: int=200)` (method) — Whatever the container has written lately.
- L126 `stop(self, deployment_id: str)` (method)
- L129 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L150 `current_runner()` (function) — The configured runner, or a clear refusal.
