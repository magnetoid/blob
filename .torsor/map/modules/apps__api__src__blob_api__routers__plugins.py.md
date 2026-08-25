---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T17:52:26'
updated: '2026-08-25T17:52:26'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L46 `PluginOut` (class)
- L72 `AppChannel` (class)
- L80 `AppChannelsOut` (class)
- L84 `PluginsOut` (class)
- L88 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L95 `InstalledOut` (class)
- L102 `RepoInput` (class)
- L110 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L124 `DeploymentOut` (class)
- L130 `LogsOut` (class)
- L134 `DeliveryOut` (class)
- L149 `DeliveriesOut` (class)
- L153 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L164 `TokenOut` (class)
- L168 `SecretOut` (class)
- L172 `OkOut` (class)
- L176 `_to_delivery(row: Any)` (function)
- L192 `_to_plugin(session: Any, row: Any)` (function)
- L233 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L238 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L250 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L316 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L344 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L350 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L364 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L399 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L419 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L449 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L465 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L483 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L507 `AgentRunOut` (class)
- L525 `AgentRunsOut` (class)
- L530 `list_runs(plugin_id: str, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L574 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L601 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L628 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L673 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L700 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L725 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L744 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L763 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L799 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L807 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L815 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L825 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
