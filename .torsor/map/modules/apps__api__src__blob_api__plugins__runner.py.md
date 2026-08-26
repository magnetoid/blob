---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L35 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L44 `normalize_fqdn(value: object)` (function) — Turn whatever the runner calls a hostname into a base URL we can append to.
- L69 `EnvVar` (class) — One configured value, as the runner holds it.
- L84 `AgentRunner` (class)
- L85 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=AGENT_PORT, compose_path: str | None=None)` (method)
- L96 `redeploy(self, deployment_id: str)` (method)
- L98 `status(self, deployment_id: str)` (method)
- L100 `logs(self, deployment_id: str, lines: int)` (method)
- L102 `stop(self, deployment_id: str)` (method)
- L104 `env(self, deployment_id: str)` (method)
- L106 `set_env(self, deployment_id: str, key: str, value: str)` (method)
- L108 `unset_env(self, deployment_id: str, key: str)` (method)
- L111 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L118 `__init__(self)` (method)
- L122 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=AGENT_PORT, compose_path: str | None=None)` (method)
- L182 `redeploy(self, deployment_id: str)` (method)
- L186 `status(self, deployment_id: str)` (method)
- L194 `logs(self, deployment_id: str, lines: int=200)` (method) — Whatever the container has written lately.
- L208 `stop(self, deployment_id: str)` (method)
- L215 `env(self, deployment_id: str)` (method) — Everything configured on the application, duplicates included.
- L241 `set_env(self, deployment_id: str, key: str, value: str)` (method) — Make `key` hold exactly `value`, by removing every row for it and writing one.
- L271 `unset_env(self, deployment_id: str, key: str)` (method) — Remove a key entirely — every row of it, for the same reason.
- L279 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L300 `current_runner()` (function) — The configured runner, or a clear refusal.
