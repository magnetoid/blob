---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:49:12'
updated: '2026-08-21T07:49:12'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L40 `PluginOut` (class)
- L64 `PluginsOut` (class)
- L68 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L75 `InstalledOut` (class)
- L82 `RepoInput` (class)
- L87 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L101 `DeploymentOut` (class)
- L107 `LogsOut` (class)
- L111 `DeliveryOut` (class)
- L122 `DeliveriesOut` (class)
- L126 `TokenOut` (class)
- L130 `SecretOut` (class)
- L134 `OkOut` (class)
- L138 `_to_plugin(session: Any, row: Any)` (function)
- L178 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L183 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L195 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L242 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L258 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L286 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L306 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L336 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L352 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L370 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L395 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L436 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L455 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L474 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L492 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L502 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L512 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L522 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
