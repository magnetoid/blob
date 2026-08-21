---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T20:31:00'
updated: '2026-08-21T20:31:00'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L35 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L44 `normalize_fqdn(value: object)` (function) — Turn whatever the runner calls a hostname into a base URL we can append to.
- L68 `AgentRunner` (class)
- L69 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L73 `redeploy(self, deployment_id: str)` (method)
- L75 `status(self, deployment_id: str)` (method)
- L77 `logs(self, deployment_id: str, lines: int)` (method)
- L79 `stop(self, deployment_id: str)` (method)
- L82 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L89 `__init__(self)` (method)
- L93 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L137 `redeploy(self, deployment_id: str)` (method)
- L141 `status(self, deployment_id: str)` (method)
- L149 `logs(self, deployment_id: str, lines: int=200)` (method) — Whatever the container has written lately.
- L163 `stop(self, deployment_id: str)` (method)
- L166 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L187 `current_runner()` (function) — The configured runner, or a clear refusal.
