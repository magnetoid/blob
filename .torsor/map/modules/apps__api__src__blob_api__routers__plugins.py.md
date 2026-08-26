---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:49:02'
updated: '2026-08-26T05:49:02'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L51 `PluginOut` (class)
- L85 `AppChannel` (class)
- L93 `AppChannelsOut` (class)
- L97 `PluginsOut` (class)
- L101 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L108 `InstalledOut` (class)
- L115 `RepoInput` (class)
- L123 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L137 `DeploymentOut` (class)
- L143 `LogsOut` (class)
- L147 `EnvVarOut` (class)
- L162 `EnvOut` (class)
- L169 `EnvInput` (class)
- L177 `DeliveryOut` (class)
- L192 `DeliveriesOut` (class)
- L196 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L207 `TokenOut` (class)
- L211 `SecretOut` (class)
- L215 `OkOut` (class)
- L219 `_to_delivery(row: Any)` (function)
- L235 `_to_plugin(session: Any, row: Any)` (function)
- L280 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L303 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L308 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L320 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L386 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L414 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L420 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L434 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L486 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L506 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L536 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L552 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L570 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L594 `AgentRunOut` (class)
- L612 `AgentRunsOut` (class)
- L617 `list_runs(plugin_id: str, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L661 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L688 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L715 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L760 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L787 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L812 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L831 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L850 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L886 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L894 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L902 `deployment_logs(plugin_id: str, lines: Annotated[int, Query(ge=10, le=1000)]=200, admin: SessionUser=Depends(require_admin))` (function) — What the container has written. Where an agent that will not start says why.
- L912 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L926 `_env_out(values: list[runner.EnvVar])` (function)
- L947 `_hint(value: str)` (function) — Enough of a secret to recognise it, never enough to use it.
- L955 `agent_env(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — What a hosted agent is configured with.
- L968 `update_agent_env(plugin_id: str, payload: EnvInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
