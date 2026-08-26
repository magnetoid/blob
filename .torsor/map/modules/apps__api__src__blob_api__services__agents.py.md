---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/src/blob_api/services/agents.py

Symbols in `apps/api/src/blob_api/services/agents.py`.

- L32 `preview(repo_url: str, ref: str)` (function) — Read the manifest so the console can show what is about to be approved.
- L37 `install_from_repo(actor: Actor, repo_url: str, ref: str, public_url: str, env: dict[str, str] | None=None)` (function)
- L96 `redeploy(actor: Actor, plugin_id: str)` (function)
- L118 `status(workspace_id: str, plugin_id: str)` (function)
- L129 `logs(workspace_id: str, plugin_id: str, lines: int=200)` (function)
- L138 `stop(actor: Actor, plugin_id: str)` (function)
- L159 `_require_deployment(plugin: object)` (function)
- L169 `_record_deployment(plugin_id: str, deployment: Deployment)` (function)
- L197 `_record_failure(plugin_id: str, reason: str)` (function)
