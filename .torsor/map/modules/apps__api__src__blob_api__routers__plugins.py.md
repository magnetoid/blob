---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T23:41:59'
updated: '2026-09-02T23:41:59'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L47 `PluginOut` (class)
- L90 `AppChannel` (class)
- L98 `AppChannelsOut` (class)
- L102 `PluginsOut` (class)
- L106 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L113 `InstalledOut` (class)
- L120 `DeliveryOut` (class)
- L135 `DeliveriesOut` (class)
- L139 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L150 `TokenOut` (class)
- L154 `SecretOut` (class)
- L158 `OkOut` (class)
- L162 `_to_delivery(row: Any)` (function)
- L178 `_to_plugin(session: Any, row: Any)` (function)
- L182 `_to_plugins(session: Any, rows: Sequence[Any])` (function) — Batch shape: three grouped queries however many plugins there are.
- L250 `_build_plugin(row: Any, *, scopes: list[str], counts: Any, bot_id: str | None, usage: tuple[int, int] | None=None)` (function)
- L292 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L315 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L320 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L332 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L398 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L434 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L440 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L454 `update_plugin(plugin_id: IdParam, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L506 `approve_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L526 `decline_plugin_scopes(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Refuse the wider permissions an update asked for; the app keeps what it had.
- L549 `set_enabled(plugin_id: IdParam, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L578 `BudgetInput` (class) — Daily caps. None lifts one; both None means unlimited, which is the default.
- L586 `set_budget(plugin_id: IdParam, payload: BudgetInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Cap what an agent may spend in a trailing day — runs begun and seconds occupied.
- L630 `rotate_secret(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L646 `issue_token(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L664 `revoke_tokens(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L688 `AgentRunOut` (class)
- L706 `AgentRunsOut` (class)
- L711 `list_runs(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L755 `list_deliveries(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L782 `read_delivery(plugin_id: IdParam, delivery_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L809 `app_channels(plugin_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L854 `app_join_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L881 `app_leave_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L906 `uninstall_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
