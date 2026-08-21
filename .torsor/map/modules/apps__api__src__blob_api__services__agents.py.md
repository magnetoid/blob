---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:40:59'
updated: '2026-08-21T06:40:59'
---

# apps/api/src/blob_api/services/agents.py

Symbols in `apps/api/src/blob_api/services/agents.py`.

- L31 `preview(repo_url: str, ref: str)` (function) — Read the manifest so the console can show what is about to be approved.
- L36 `install_from_repo(actor: Actor, repo_url: str, ref: str, public_url: str)` (function)
- L85 `redeploy(actor: Actor, plugin_id: str)` (function)
- L107 `status(workspace_id: str, plugin_id: str)` (function)
- L118 `stop(actor: Actor, plugin_id: str)` (function)
- L139 `_require_deployment(plugin: object)` (function)
- L149 `_record_deployment(plugin_id: str, deployment: Deployment)` (function)
- L172 `_record_failure(plugin_id: str, reason: str)` (function)
