---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-17T02:03:39'
updated: '2026-09-17T02:03:39'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L48 `PluginOut` (class)
- L108 `AppChannel` (class)
- L116 `AppChannelsOut` (class)
- L120 `PluginsOut` (class)
- L124 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L131 `InstalledOut` (class)
- L138 `DeliveryOut` (class)
- L153 `DeliveriesOut` (class)
- L157 `DeliveryDetailOut` (class) — One delivery, with the body the app was sent.
- L168 `TokenOut` (class)
- L172 `SecretOut` (class)
- L176 `_to_delivery(row: Any)` (function)
- L192 `_to_plugin(session: Any, row: Any)` (function)
- L196 `_to_plugins(session: Any, rows: Sequence[Any])` (function) — Batch shape: three grouped queries however many plugins there are.
- L219 `_build_plugin(row: Any, *, scopes: list[str], counts: Any, bot_id: str | None, usage: tuple[int, int] | None=None, activity: tuple[int, int] | None=None, channel_count: int=0)` (function)
- L269 `agent_bridge_source(_admin: SessionUser=Depends(require_admin))` (function) — The bridge script, so a desktop agent can be connected with two commands.
- L292 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L297 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L303 `ActivityDay` (class)
- L308 `ActivityOut` (class)
- L315 `activity(admin: SessionUser=Depends(require_admin))` (function) — Runs per day over the trailing week, for the console's chart. Zeros included.
- L323 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L389 `_assert_reachable(url: str | None, policy: policy_service.Policy)` (function) — Refuse a request URL the server should not be made to fetch.
- L425 `_assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str])` (function)
- L431 `_assert_within_policy(session: Any, workspace_id: str, policy: policy_service.Policy, scopes: list[str])` (function) — Everything an install has to satisfy that is not about the manifest being valid.
- L444 `AgentOwnerInput` (class)
- L450 `set_agent_owner(plugin_id: IdParam, payload: AgentOwnerInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Give an agent to a person, or hand it back to the workspace.
- L480 `update_plugin(plugin_id: IdParam, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L532 `approve_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L552 `decline_plugin_scopes(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Refuse the wider permissions an update asked for; the app keeps what it had.
- L575 `set_enabled(plugin_id: IdParam, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L604 `BudgetInput` (class) — Daily caps. None lifts one; both None means unlimited, which is the default.
- L612 `set_budget(plugin_id: IdParam, payload: BudgetInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Cap what an agent may spend in a trailing day — runs begun and seconds occupied.
- L655 `_assert_the_workspace_may_direct(row: Any, *, owned: str, not_seeded: str)` (function) — Both controls below are the workspace's word about **the agent Blob seeded**.
- L675 `InstructionsInput` (class) — What the workspace tells its agent. Empty, blank or an explicit null clears it.
- L690 `_trim_before_measuring(cls, value: Any)` (method) — Trimmed before the length check, not after it.
- L701 `set_instructions(plugin_id: IdParam, payload: InstructionsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Set (or clear) the standing instruction this workspace sends with every run.
- L739 `EverywhereInput` (class)
- L746 `set_everywhere(plugin_id: IdParam, payload: EverywhereInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Whether this agent joins public channels founded from now on.
- L787 `rotate_secret(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L803 `issue_token(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L821 `revoke_tokens(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L837 `AgentRunOut` (class)
- L859 `AgentRunsOut` (class)
- L864 `list_runs(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=100)]=30, admin: SessionUser=Depends(require_admin))` (function) — What happened the last few times this agent was asked something.
- L910 `list_deliveries(plugin_id: IdParam, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L923 `read_delivery(plugin_id: IdParam, delivery_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — One delivery in full, including the payload the app was sent.
- L936 `replay_delivery(plugin_id: IdParam, delivery_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Queue a failed or dead delivery to be sent again.
- L963 `app_channels(plugin_id: IdParam, admin: SessionUser=Depends(require_admin))` (function) — Where this app can speak, and where it could.
- L990 `app_join_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L1017 `app_leave_channel(plugin_id: IdParam, channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L1042 `uninstall_plugin(plugin_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
