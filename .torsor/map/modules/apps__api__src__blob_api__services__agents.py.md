---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:49:12'
updated: '2026-08-21T07:49:12'
---

# apps/api/src/blob_api/services/agents.py

Symbols in `apps/api/src/blob_api/services/agents.py`.

- L31 `preview(repo_url: str, ref: str)` (function) — Read the manifest so the console can show what is about to be approved.
- L36 `install_from_repo(actor: Actor, repo_url: str, ref: str, public_url: str)` (function)
- L85 `redeploy(actor: Actor, plugin_id: str)` (function)
- L107 `status(workspace_id: str, plugin_id: str)` (function)
- L118 `logs(workspace_id: str, plugin_id: str, lines: int=200)` (function)
- L127 `stop(actor: Actor, plugin_id: str)` (function)
- L148 `_require_deployment(plugin: object)` (function)
- L158 `_record_deployment(plugin_id: str, deployment: Deployment)` (function)
- L181 `_record_failure(plugin_id: str, reason: str)` (function)
