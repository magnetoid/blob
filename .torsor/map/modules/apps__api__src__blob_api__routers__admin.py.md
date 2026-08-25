---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L46 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L63 `AdminUsersOut` (class)
- L68 `RoleInput` (class)
- L72 `AdminChannel` (class)
- L85 `AdminChannelsOut` (class)
- L89 `AdminInvite` (class)
- L103 `AdminInvitesOut` (class)
- L107 `AuditOut` (class)
- L111 `WorkspaceSettingsOut` (class)
- L117 `SettingsInput` (class)
- L122 `HealthOut` (class)
- L133 `OkOut` (class)
- L137 `WebhookOut` (class)
- L147 `WebhooksOut` (class)
- L151 `CreateWebhookInput` (class)
- L158 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L226 `set_role(user_id: str, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L286 `deactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L334 `reactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L383 `revoke_sessions(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L407 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L456 `require_iso_now()` (function)
- L463 `revoke_invite(invite_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L493 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L538 `archive_any_channel(channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L572 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L593 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L614 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L669 `health(admin: SessionUser=Depends(require_admin))` (function)
- L714 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L742 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L801 `revoke_webhook(webhook_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L838 `InstanceUser` (class)
- L850 `InstanceUsersOut` (class)
- L854 `InstanceWorkspace` (class)
- L864 `InstanceWorkspacesOut` (class)
- L869 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L908 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L954 `CreateWorkspaceInput` (class)
- L958 `CreatedWorkspaceOut` (class)
- L965 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L1003 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L1022 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L1032 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L1046 `read_policy(workspace_id: str, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L1060 `write_policy(workspace_id: str, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
- L1096 `CustomEmojiOut` (class)
- L1103 `CustomEmojiListOut` (class)
- L1107 `AddEmojiInput` (class)
- L1115 `list_custom_emoji(admin: SessionUser=Depends(require_admin))` (function)
- L1146 `add_custom_emoji(payload: AddEmojiInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Name an uploaded image so `:name:` resolves to it.
- L1220 `remove_custom_emoji(name: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Take a name out of circulation.
