---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:20'
updated: '2026-09-02T05:49:20'
---

# apps/api/src/blob_api/plugins/runner.py

Symbols in `apps/api/src/blob_api/plugins/runner.py`.

- L36 `Deployment` (class) — What the runner gives back. `id` is opaque to us — it is the runner's handle.
- L45 `_reported_domain(payload: dict[str, Any])` (function) — The address the proxy actually answers on, out of the two Coolify offers.
- L69 `_strip_container_port(domain: str)` (function) — Drop the `:port` suffix from a Coolify compose domain.
- L87 `normalize_fqdn(value: object)` (function) — Turn whatever the runner calls a hostname into a base URL we can append to.
- L112 `EnvVar` (class) — One configured value, as the runner holds it.
- L127 `AgentRunner` (class)
- L128 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=AGENT_PORT, compose_path: str | None=None)` (method)
- L139 `redeploy(self, deployment_id: str)` (method)
- L141 `status(self, deployment_id: str)` (method)
- L143 `logs(self, deployment_id: str, lines: int)` (method)
- L145 `stop(self, deployment_id: str)` (method)
- L147 `env(self, deployment_id: str)` (method)
- L149 `set_env(self, deployment_id: str, key: str, value: str)` (method)
- L151 `unset_env(self, deployment_id: str, key: str)` (method)
- L154 `CoolifyRunner` (class) — Deploys into the same Coolify project as Blob itself.
- L161 `__init__(self)` (method)
- L165 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=AGENT_PORT, compose_path: str | None=None)` (method)
- L225 `redeploy(self, deployment_id: str)` (method)
- L229 `status(self, deployment_id: str)` (method)
- L237 `logs(self, deployment_id: str, lines: int=200)` (method) — Whatever the container has written lately.
- L251 `stop(self, deployment_id: str)` (method)
- L258 `env(self, deployment_id: str)` (method) — What the running container is configured with — duplicates included.
- L293 `set_env(self, deployment_id: str, key: str, value: str)` (method) — Make `key` hold exactly `value`, by removing every row for it and writing one.
- L321 `unset_env(self, deployment_id: str, key: str)` (method) — Remove a key entirely — every row of it, preview twins included.
- L326 `_env_row_ids(self, deployment_id: str, key: str)` (method) — Every stored row for a key, unfiltered — what a rewrite has to clear.
- L336 `_call(self, method: str, path: str, body: dict[str, Any] | None=None)` (method)
- L357 `current_runner()` (function) — The configured runner, or a clear refusal.
