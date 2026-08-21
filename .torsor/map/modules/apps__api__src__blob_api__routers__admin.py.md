---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:48:04'
updated: '2026-08-21T03:48:04'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L32 `actor_for(request: Request, user: SessionUser)` (function)
- L41 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L58 `AdminUsersOut` (class)
- L63 `RoleInput` (class)
- L67 `AdminChannel` (class)
- L80 `AdminChannelsOut` (class)
- L84 `AdminInvite` (class)
- L98 `AdminInvitesOut` (class)
- L102 `AuditOut` (class)
- L106 `WorkspaceSettingsOut` (class)
- L112 `SettingsInput` (class)
- L117 `HealthOut` (class)
- L128 `OkOut` (class)
- L132 `WebhookOut` (class)
- L142 `WebhooksOut` (class)
- L146 `CreateWebhookInput` (class)
- L153 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L221 `set_role(user_id: str, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L281 `deactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L329 `reactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L378 `revoke_sessions(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L402 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L451 `require_iso_now()` (function)
- L458 `revoke_invite(invite_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L488 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L533 `archive_any_channel(channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L567 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L588 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L609 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L664 `health(admin: SessionUser=Depends(require_admin))` (function)
- L709 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L737 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L796 `revoke_webhook(webhook_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
