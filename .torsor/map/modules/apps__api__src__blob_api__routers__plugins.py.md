---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L46 `PluginOut` (class)
- L89 `AppChannel` (class)
- L97 `AppChannelsOut` (class)
- L101 `PluginsOut` (class)
- L105 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L112 `InstalledOut` (class)
- L119 `DeliveryOut` (class)
- L134 `DeliveriesOut` (class)
- L138 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L149 `TokenOut` (class)
- L153 `SecretOut` (class)
- L157 `OkOut` (class)
- L161 `_to_delivery(row: Any)` (function)
- L177 `_to_plugin(session: Any, row: Any)` (function)
- L181 `_to_plugins(session: Any, rows: Sequence[Any])` (function) — Batch shape: three grouped queries however many plugins there are.
- L249 `_build_plugin(row: Any, *, scopes: list[str], counts: Any, bot_id: str | None, usage: tuple[int, int] | None=None)` (function)
- L291 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L314 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L319 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L331 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L397 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L433 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L439 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L453 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L505 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L525 `decline_plugin_scopes(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Refuse the wider permissions an update asked for; the app keeps what it had.
- L548 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L577 `BudgetInput` (class) — Daily caps. None lifts one; both None means unlimited, which is the default.
- L585 `set_budget(plugin_id: str, payload: BudgetInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Cap what an agent may spend in a trailing day — runs begun and seconds occupied.
- L629 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L645 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L663 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L687 `AgentRunOut` (class)
- L705 `AgentRunsOut` (class)
- L710 `list_runs(plugin_id: str, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L754 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L781 `read_delivery(plugin_id: str, delivery_id: str, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L808 `app_channels(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L853 `app_join_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L880 `app_leave_channel(plugin_id: str, channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L905 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
