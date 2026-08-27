---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L36 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L45 `_reported_domain(payload: dict[str, Any])` (function) — The address the proxy actually answers on, out of the two Coolify offers.
- L69 `normalize_fqdn(value: object)` (function) — Turn whatever the runner calls a hostname into a base URL we can append to.
- L94 `EnvVar` (class) — One configured value, as the runner holds it.
- L109 `AgentRunner` (class)
- L110 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=AGENT_PORT, compose_path: str | None=None)` (method)
- L121 `redeploy(self, deployment_id: str)` (method)
- L123 `status(self, deployment_id: str)` (method)
- L125 `logs(self, deployment_id: str, lines: int)` (method)
- L127 `stop(self, deployment_id: str)` (method)
- L129 `env(self, deployment_id: str)` (method)
- L131 `set_env(self, deployment_id: str, key: str, value: str)` (method)
- L133 `unset_env(self, deployment_id: str, key: str)` (method)
- L136 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L143 `__init__(self)` (method)
- L147 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=AGENT_PORT, compose_path: str | None=None)` (method)
- L207 `redeploy(self, deployment_id: str)` (method)
- L211 `status(self, deployment_id: str)` (method)
- L219 `logs(self, deployment_id: str, lines: int=200)` (method) — Whatever the container has written lately.
- L233 `stop(self, deployment_id: str)` (method)
- L240 `env(self, deployment_id: str)` (method) — What the running container is configured with — duplicates included.
- L275 `set_env(self, deployment_id: str, key: str, value: str)` (method) — Make `key` hold exactly `value`, by removing every row for it and writing one.
- L303 `unset_env(self, deployment_id: str, key: str)` (method) — Remove a key entirely — every row of it, preview twins included.
- L308 `_env_row_ids(self, deployment_id: str, key: str)` (method) — Every stored row for a key, unfiltered — what a rewrite has to clear.
- L318 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L339 `current_runner()` (function) — The configured runner, or a clear refusal.
