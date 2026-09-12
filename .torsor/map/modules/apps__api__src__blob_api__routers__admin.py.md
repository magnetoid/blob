---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L43 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L60 `AdminUsersOut` (class)
- L65 `RoleInput` (class)
- L69 `AdminChannel` (class)
- L82 `AdminChannelsOut` (class)
- L86 `AdminInvite` (class)
- L100 `AdminInvitesOut` (class)
- L104 `AuditOut` (class)
- L108 `WorkspaceSettingsOut` (class)
- L114 `SettingsInput` (class)
- L119 `AdminDeliveryOut` (class)
- L133 `AdminDeliveriesOut` (class)
- L137 `HealthOut` (class)
- L158 `OkOut` (class)
- L162 `WebhookOut` (class)
- L172 `WebhooksOut` (class)
- L176 `CreateWebhookInput` (class)
- L183 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L251 `set_role(user_id: IdParam, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L314 `deactivate(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L369 `reactivate(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L425 `revoke_sessions(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L458 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L507 `require_iso_now()` (function)
- L513 `revoke_invite(invite_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L543 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L588 `archive_any_channel(channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L624 `unarchive_any_channel(channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Reopen an archived channel.
- L668 `ResetLinkOut` (class)
- L674 `create_reset_link(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a password-reset link for somebody, for an admin to hand over.
- L733 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L754 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L775 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L830 `list_workspace_deliveries(limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — Every app's recent deliveries, for the console log.
- L878 `health(admin: SessionUser=Depends(require_admin))` (function)
- L929 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L957 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L1015 `revoke_webhook(webhook_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
