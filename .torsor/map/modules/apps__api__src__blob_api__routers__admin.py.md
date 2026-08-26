---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L48 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L65 `AdminUsersOut` (class)
- L70 `RoleInput` (class)
- L74 `AdminChannel` (class)
- L87 `AdminChannelsOut` (class)
- L91 `AdminInvite` (class)
- L105 `AdminInvitesOut` (class)
- L109 `AuditOut` (class)
- L113 `WorkspaceSettingsOut` (class)
- L119 `SettingsInput` (class)
- L124 `HealthOut` (class)
- L135 `OkOut` (class)
- L139 `WebhookOut` (class)
- L149 `WebhooksOut` (class)
- L153 `CreateWebhookInput` (class)
- L160 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L228 `set_role(user_id: str, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L291 `deactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L347 `reactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L403 `revoke_sessions(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L427 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L476 `require_iso_now()` (function)
- L483 `revoke_invite(invite_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L513 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L558 `archive_any_channel(channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L592 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L613 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L634 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L689 `health(admin: SessionUser=Depends(require_admin))` (function)
- L737 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L765 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L824 `revoke_webhook(webhook_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L861 `InstanceUser` (class)
- L873 `InstanceUsersOut` (class)
- L877 `InstanceWorkspace` (class)
- L887 `InstanceWorkspacesOut` (class)
- L892 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L931 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L977 `CreateWorkspaceInput` (class)
- L981 `CreatedWorkspaceOut` (class)
- L988 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L1026 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L1045 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L1055 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L1069 `read_policy(workspace_id: str, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L1083 `write_policy(workspace_id: str, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
- L1119 `CustomEmojiOut` (class)
- L1126 `CustomEmojiListOut` (class)
- L1130 `AddEmojiInput` (class)
- L1138 `list_custom_emoji(admin: SessionUser=Depends(require_admin))` (function)
- L1169 `add_custom_emoji(payload: AddEmojiInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Name an uploaded image so `:name:` resolves to it.
- L1243 `remove_custom_emoji(name: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Take a name out of circulation.
- L1282 `ServerLogEntry` (class)
- L1294 `ServerLogsOut` (class)
- L1302 `list_server_logs(level: str | None=None, limit: Annotated[int, Query(ge=1, le=500)]=100, _admin: SessionUser=Depends(require_instance_admin))` (function) — Recent warnings and errors, newest first.
- L1321 `clear_server_logs(request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Empty the buffer — "I have dealt with these", which is its only state.
