---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L45 `PluginOut` (class)
- L71 `AppChannel` (class)
- L79 `AppChannelsOut` (class)
- L83 `PluginsOut` (class)
- L87 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L94 `InstalledOut` (class)
- L101 `RepoInput` (class)
- L109 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L123 `DeploymentOut` (class)
- L129 `LogsOut` (class)
- L133 `DeliveryOut` (class)
- L148 `DeliveriesOut` (class)
- L152 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L163 `TokenOut` (class)
- L167 `SecretOut` (class)
- L171 `OkOut` (class)
- L175 `_to_delivery(row: Any)` (function)
- L191 `_to_plugin(session: Any, row: Any)` (function)
- L232 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L237 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L249 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L315 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L343 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L349 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L363 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L398 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L418 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L448 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L464 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L482 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L507 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L534 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L561 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L606 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L633 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L658 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L677 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L696 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L732 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L740 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L748 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L758 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
