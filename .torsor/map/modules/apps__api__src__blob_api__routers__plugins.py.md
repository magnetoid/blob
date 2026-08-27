---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:41'
updated: '2026-08-27T02:15:41'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L46 `PluginOut` (class)
- L80 `AppChannel` (class)
- L88 `AppChannelsOut` (class)
- L92 `PluginsOut` (class)
- L96 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L103 `InstalledOut` (class)
- L110 `DeliveryOut` (class)
- L125 `DeliveriesOut` (class)
- L129 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L140 `TokenOut` (class)
- L144 `SecretOut` (class)
- L148 `OkOut` (class)
- L152 `_to_delivery(row: Any)` (function)
- L168 `_to_plugin(session: Any, row: Any)` (function)
- L172 `_to_plugins(session: Any, rows: Sequence[Any])` (function) — Batch shape: three grouped queries however many plugins there are.
- L237 `_build_plugin(row: Any, *, scopes: list[str], counts: Any, bot_id: str | None)` (function)
- L269 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L292 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L297 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L309 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L375 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L411 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L417 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L431 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L483 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L503 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L533 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L549 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L567 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L591 `AgentRunOut` (class)
- L609 `AgentRunsOut` (class)
- L614 `list_runs(plugin_id: str, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L658 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L685 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L712 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L757 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L784 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L809 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
