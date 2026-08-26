---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/src/blob_api/services/agents.py

Symbols in `apps/api/src/blob_api/services/agents.py`.

- L40 `preview(repo_url: str, ref: str)` (function) — Read the manifest so the console can show what is about to be approved.
- L45 `install_from_repo(actor: Actor, repo_url: str, ref: str, public_url: str, env: dict[str, str] | None=None)` (function)
- L116 `_await_address(workspace_id: str, plugin_id: str, agui_path: str | None)` (function) — Ask the runner for the hostname until it has one, within reason.
- L136 `redeploy(actor: Actor, plugin_id: str)` (function)
- L158 `status(workspace_id: str, plugin_id: str, *, agui_path: str | None=None)` (function)
- L169 `_agui_path_of(plugin: object)` (function) — Recover the declared path from the URL already stored, so a redeploy keeps it.
- L184 `logs(workspace_id: str, plugin_id: str, lines: int=200)` (function)
- L193 `env(workspace_id: str, plugin_id: str)` (function) — What the agent is configured with, as the runner holds it.
- L203 `set_env(actor: Actor, plugin_id: str, values: dict[str, str], remove: list[str])` (function) — Write configuration, then say so — without ever writing a value into the log.
- L236 `stop(actor: Actor, plugin_id: str)` (function)
- L257 `_require_deployment(plugin: object)` (function)
- L267 `_record_deployment(plugin_id: str, deployment: Deployment, *, agui_path: str | None=None)` (function)
- L304 `_record_failure(plugin_id: str, reason: str)` (function)
