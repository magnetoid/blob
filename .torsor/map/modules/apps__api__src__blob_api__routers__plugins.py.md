---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T04:12:52'
updated: '2026-08-22T04:12:52'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L42 `PluginOut` (class)
- L68 `AppChannel` (class)
- L76 `AppChannelsOut` (class)
- L80 `PluginsOut` (class)
- L84 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L91 `InstalledOut` (class)
- L98 `RepoInput` (class)
- L106 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L120 `DeploymentOut` (class)
- L126 `LogsOut` (class)
- L130 `DeliveryOut` (class)
- L145 `DeliveriesOut` (class)
- L149 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L160 `TokenOut` (class)
- L164 `SecretOut` (class)
- L168 `OkOut` (class)
- L172 `_to_delivery(row: Any)` (function)
- L188 `_to_plugin(session: Any, row: Any)` (function)
- L229 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L234 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L246 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L294 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L314 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L343 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L363 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L393 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L409 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L427 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L452 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L479 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L506 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L551 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L578 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L603 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L622 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L641 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L663 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L673 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L683 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L693 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
