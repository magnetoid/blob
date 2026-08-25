---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T04:30:13'
updated: '2026-08-25T04:30:13'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L47 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L64 `AdminUsersOut` (class)
- L69 `RoleInput` (class)
- L73 `AdminChannel` (class)
- L86 `AdminChannelsOut` (class)
- L90 `AdminInvite` (class)
- L104 `AdminInvitesOut` (class)
- L108 `AuditOut` (class)
- L112 `WorkspaceSettingsOut` (class)
- L118 `SettingsInput` (class)
- L123 `HealthOut` (class)
- L134 `OkOut` (class)
- L138 `WebhookOut` (class)
- L148 `WebhooksOut` (class)
- L152 `CreateWebhookInput` (class)
- L159 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L227 `set_role(user_id: str, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L287 `deactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L335 `reactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L384 `revoke_sessions(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L408 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L457 `require_iso_now()` (function)
- L464 `revoke_invite(invite_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L494 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L539 `archive_any_channel(channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L573 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L594 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L615 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L670 `health(admin: SessionUser=Depends(require_admin))` (function)
- L715 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L743 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L802 `revoke_webhook(webhook_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L839 `InstanceUser` (class)
- L851 `InstanceUsersOut` (class)
- L855 `InstanceWorkspace` (class)
- L865 `InstanceWorkspacesOut` (class)
- L870 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L909 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L955 `CreateWorkspaceInput` (class)
- L959 `CreatedWorkspaceOut` (class)
- L966 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L1004 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L1023 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L1033 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L1047 `read_policy(workspace_id: str, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L1061 `write_policy(workspace_id: str, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
- L1097 `CustomEmojiOut` (class)
- L1104 `CustomEmojiListOut` (class)
- L1108 `AddEmojiInput` (class)
- L1116 `list_custom_emoji(admin: SessionUser=Depends(require_admin))` (function)
- L1147 `add_custom_emoji(payload: AddEmojiInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Name an uploaded image so `:name:` resolves to it.
- L1221 `remove_custom_emoji(name: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Take a name out of circulation.
- L1260 `ServerLogEntry` (class)
- L1272 `ServerLogsOut` (class)
- L1280 `list_server_logs(level: str | None=None, limit: Annotated[int, Query(ge=1, le=500)]=100, _admin: SessionUser=Depends(require_instance_admin))` (function) — Recent warnings and errors, newest first.
- L1299 `clear_server_logs(request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Empty the buffer — "I have dealt with these", which is its only state.
