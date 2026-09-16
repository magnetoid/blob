---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L46 `PluginOut` (class)
- L99 `AppChannel` (class)
- L107 `AppChannelsOut` (class)
- L111 `PluginsOut` (class)
- L115 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L122 `InstalledOut` (class)
- L129 `DeliveryOut` (class)
- L144 `DeliveriesOut` (class)
- L148 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L159 `TokenOut` (class)
- L163 `SecretOut` (class)
- L167 `_to_delivery(row: Any)` (function)
- L183 `_to_plugin(session: Any, row: Any)` (function)
- L187 `_to_plugins(session: Any, rows: Sequence[Any])` (function) — Batch shape: three grouped queries however many plugins there are.
- L210 `_build_plugin(row: Any, *, scopes: list[str], counts: Any, bot_id: str | None, usage: tuple[int, int] | None=None, activity: tuple[int, int] | None=None, channel_count: int=0)` (function)
- L258 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L281 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L286 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L292 `ActivityDay` (class)
- L297 `ActivityOut` (class)
- L304 `activity(admin: SessionUser=Depends(require_admin))` (function) — Runs per day over the trailing week, for the console's chart. Zeros included.
- L312 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L378 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L414 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L420 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L433 `AgentOwnerInput` (class)
- L439 `set_agent_owner(plugin_id: IdParam, payload: AgentOwnerInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Give an agent to a person, or hand it back to the workspace.
- L469 `update_plugin(plugin_id: IdParam, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L521 `approve_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L541 `decline_plugin_scopes(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Refuse the wider permissions an update asked for; the app keeps what it had.
- L564 `set_enabled(plugin_id: IdParam, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L593 `BudgetInput` (class) — Daily caps. None lifts one; both None means unlimited, which is the default.
- L601 `set_budget(plugin_id: IdParam, payload: BudgetInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Cap what an agent may spend in a trailing day — runs begun and seconds occupied.
- L645 `rotate_secret(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L661 `issue_token(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L679 `revoke_tokens(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L695 `AgentRunOut` (class)
- L717 `AgentRunsOut` (class)
- L722 `list_runs(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L768 `list_deliveries(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L781 `read_delivery(plugin_id: IdParam, delivery_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L794 `replay_delivery(plugin_id: IdParam, delivery_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Queue a failed or dead delivery to be sent again.
- L821 `app_channels(plugin_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L848 `app_join_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L875 `app_leave_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L900 `uninstall_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
