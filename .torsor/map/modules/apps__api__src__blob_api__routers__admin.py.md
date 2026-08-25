---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T01:55:20'
updated: '2026-08-25T01:55:20'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L44 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L61 `AdminUsersOut` (class)
- L66 `RoleInput` (class)
- L70 `AdminChannel` (class)
- L83 `AdminChannelsOut` (class)
- L87 `AdminInvite` (class)
- L101 `AdminInvitesOut` (class)
- L105 `AuditOut` (class)
- L109 `WorkspaceSettingsOut` (class)
- L115 `SettingsInput` (class)
- L120 `HealthOut` (class)
- L131 `OkOut` (class)
- L135 `WebhookOut` (class)
- L145 `WebhooksOut` (class)
- L149 `CreateWebhookInput` (class)
- L156 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L224 `set_role(user_id: str, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L284 `deactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L332 `reactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L381 `revoke_sessions(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L405 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L454 `require_iso_now()` (function)
- L461 `revoke_invite(invite_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L491 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L536 `archive_any_channel(channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L570 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L591 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L612 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L667 `health(admin: SessionUser=Depends(require_admin))` (function)
- L712 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L740 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L799 `revoke_webhook(webhook_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L836 `InstanceUser` (class)
- L848 `InstanceUsersOut` (class)
- L852 `InstanceWorkspace` (class)
- L862 `InstanceWorkspacesOut` (class)
- L867 `instance_users(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every account on the server, whichever workspace it belongs to.
- L906 `instance_workspaces(_admin: SessionUser=Depends(require_instance_admin))` (function) — Every workspace on the server, with enough to tell them apart at a glance.
- L952 `CreateWorkspaceInput` (class)
- L956 `CreatedWorkspaceOut` (class)
- L963 `create_workspace(payload: CreateWorkspaceInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Make another workspace, owned by whoever made it.
- L1001 `PolicyOut` (class) — A workspace's policy, and what the server permits regardless.
- L1020 `PolicyInput` (class) — Every field optional: a PUT that sets one switch should not clear the others.
- L1030 `_policy_out(workspace_id: str, policy: policy_service.Policy)` (function)
- L1044 `read_policy(workspace_id: str, _admin: SessionUser=Depends(require_instance_admin))` (function) — What is written down for this workspace — not what the guards compute.
- L1058 `write_policy(workspace_id: str, payload: PolicyInput, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Set what a workspace may do to this machine.
