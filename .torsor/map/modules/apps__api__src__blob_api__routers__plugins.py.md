---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:50:54'
updated: '2026-08-26T03:50:54'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L49 `PluginOut` (class)
- L75 `AppChannel` (class)
- L83 `AppChannelsOut` (class)
- L87 `PluginsOut` (class)
- L91 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L98 `InstalledOut` (class)
- L105 `RepoInput` (class)
- L113 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L127 `DeploymentOut` (class)
- L133 `LogsOut` (class)
- L137 `DeliveryOut` (class)
- L152 `DeliveriesOut` (class)
- L156 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L167 `TokenOut` (class)
- L171 `SecretOut` (class)
- L175 `OkOut` (class)
- L179 `_to_delivery(row: Any)` (function)
- L195 `_to_plugin(session: Any, row: Any)` (function)
- L236 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L259 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L264 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L276 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L342 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L370 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L376 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L390 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L425 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L445 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L475 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L491 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L509 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L533 `AgentRunOut` (class)
- L551 `AgentRunsOut` (class)
- L556 `list_runs(plugin_id: str, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L600 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L627 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L654 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L699 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L726 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L751 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L770 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L789 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L825 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L833 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L841 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L851 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
