---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L47 `PluginOut` (class)
- L94 `AppChannel` (class)
- L102 `AppChannelsOut` (class)
- L106 `PluginsOut` (class)
- L110 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L117 `InstalledOut` (class)
- L124 `DeliveryOut` (class)
- L139 `DeliveriesOut` (class)
- L143 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L154 `TokenOut` (class)
- L158 `SecretOut` (class)
- L162 `OkOut` (class)
- L166 `_to_delivery(row: Any)` (function)
- L182 `_to_plugin(session: Any, row: Any)` (function)
- L186 `_to_plugins(session: Any, rows: Sequence[Any])` (function) — Batch shape: three grouped queries however many plugins there are.
- L254 `_build_plugin(row: Any, *, scopes: list[str], counts: Any, bot_id: str | None, usage: tuple[int, int] | None=None)` (function)
- L297 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L320 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L325 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L337 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L403 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L439 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L445 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L458 `AgentOwnerInput` (class)
- L464 `set_agent_owner(plugin_id: IdParam, payload: AgentOwnerInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Give an agent to a person, or hand it back to the workspace.
- L513 `update_plugin(plugin_id: IdParam, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L565 `approve_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L585 `decline_plugin_scopes(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Refuse the wider permissions an update asked for; the app keeps what it had.
- L608 `set_enabled(plugin_id: IdParam, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L637 `BudgetInput` (class) — Daily caps. None lifts one; both None means unlimited, which is the default.
- L645 `set_budget(plugin_id: IdParam, payload: BudgetInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Cap what an agent may spend in a trailing day — runs begun and seconds occupied.
- L689 `rotate_secret(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L705 `issue_token(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L723 `revoke_tokens(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L747 `AgentRunOut` (class)
- L769 `AgentRunsOut` (class)
- L774 `list_runs(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L820 `list_deliveries(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L847 `read_delivery(plugin_id: IdParam, delivery_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L874 `app_channels(plugin_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L919 `app_join_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L946 `app_leave_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L971 `uninstall_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
