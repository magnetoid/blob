---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T03:21:58'
updated: '2026-08-22T03:21:58'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L41 `PluginOut` (class)
- L67 `PluginsOut` (class)
- L71 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L78 `InstalledOut` (class)
- L85 `RepoInput` (class)
- L93 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L107 `DeploymentOut` (class)
- L113 `LogsOut` (class)
- L117 `DeliveryOut` (class)
- L132 `DeliveriesOut` (class)
- L136 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L147 `TokenOut` (class)
- L151 `SecretOut` (class)
- L155 `OkOut` (class)
- L159 `_to_delivery(row: Any)` (function)
- L175 `_to_plugin(session: Any, row: Any)` (function)
- L216 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L221 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L233 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L281 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L301 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L330 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L350 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L380 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L396 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L414 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L439 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L466 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L493 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L512 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L531 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L553 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L563 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L573 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L583 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
