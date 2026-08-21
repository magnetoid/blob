---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T01:05:35'
updated: '2026-08-22T01:05:35'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L41 `PluginOut` (class)
- L65 `PluginsOut` (class)
- L69 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L76 `InstalledOut` (class)
- L83 `RepoInput` (class)
- L91 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L105 `DeploymentOut` (class)
- L111 `LogsOut` (class)
- L115 `DeliveryOut` (class)
- L130 `DeliveriesOut` (class)
- L134 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L145 `TokenOut` (class)
- L149 `SecretOut` (class)
- L153 `OkOut` (class)
- L157 `_to_delivery(row: Any)` (function)
- L173 `_to_plugin(session: Any, row: Any)` (function)
- L213 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L218 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L230 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L277 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L293 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L321 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L341 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L371 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L387 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L405 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L430 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L457 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L484 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L503 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L522 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L544 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L554 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L564 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L574 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
