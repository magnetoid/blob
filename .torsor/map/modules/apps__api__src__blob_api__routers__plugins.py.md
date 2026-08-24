---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T22:36:29'
updated: '2026-08-24T22:36:29'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L44 `PluginOut` (class)
- L70 `AppChannel` (class)
- L78 `AppChannelsOut` (class)
- L82 `PluginsOut` (class)
- L86 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L93 `InstalledOut` (class)
- L100 `RepoInput` (class)
- L108 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L122 `DeploymentOut` (class)
- L128 `LogsOut` (class)
- L132 `DeliveryOut` (class)
- L147 `DeliveriesOut` (class)
- L151 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L162 `TokenOut` (class)
- L166 `SecretOut` (class)
- L170 `OkOut` (class)
- L174 `_to_delivery(row: Any)` (function)
- L190 `_to_plugin(session: Any, row: Any)` (function)
- L231 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L236 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L248 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L308 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L336 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L366 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L386 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L416 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L432 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L450 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L475 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L502 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L529 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L574 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L601 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L626 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L645 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L664 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L686 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L694 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L702 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L712 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
