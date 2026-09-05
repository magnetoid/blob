---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L42 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L59 `AdminUsersOut` (class)
- L64 `RoleInput` (class)
- L68 `AdminChannel` (class)
- L81 `AdminChannelsOut` (class)
- L85 `AdminInvite` (class)
- L99 `AdminInvitesOut` (class)
- L103 `AuditOut` (class)
- L107 `WorkspaceSettingsOut` (class)
- L113 `SettingsInput` (class)
- L118 `HealthOut` (class)
- L129 `OkOut` (class)
- L133 `WebhookOut` (class)
- L143 `WebhooksOut` (class)
- L147 `CreateWebhookInput` (class)
- L154 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L222 `set_role(user_id: IdParam, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L285 `deactivate(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L340 `reactivate(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L396 `revoke_sessions(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L429 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L478 `require_iso_now()` (function)
- L484 `revoke_invite(invite_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L514 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L559 `archive_any_channel(channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L595 `unarchive_any_channel(channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Reopen an archived channel.
- L638 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L659 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L680 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L735 `health(admin: SessionUser=Depends(require_admin))` (function)
- L783 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L811 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L869 `revoke_webhook(webhook_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
