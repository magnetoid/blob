---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T20:31:00'
updated: '2026-08-21T20:31:00'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L33 `AdminUser` (class) — Richer than the public `User`, which deliberately omits email.
- L50 `AdminUsersOut` (class)
- L55 `RoleInput` (class)
- L59 `AdminChannel` (class)
- L72 `AdminChannelsOut` (class)
- L76 `AdminInvite` (class)
- L90 `AdminInvitesOut` (class)
- L94 `AuditOut` (class)
- L98 `WorkspaceSettingsOut` (class)
- L104 `SettingsInput` (class)
- L109 `HealthOut` (class)
- L120 `OkOut` (class)
- L124 `WebhookOut` (class)
- L134 `WebhooksOut` (class)
- L138 `CreateWebhookInput` (class)
- L145 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, offset: Annotated[int, Query(ge=0)]=0, admin: SessionUser=Depends(require_admin))` (function)
- L213 `set_role(user_id: str, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L273 `deactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L321 `reactivate(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L370 `revoke_sessions(user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L394 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L443 `require_iso_now()` (function)
- L450 `revoke_invite(invite_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L480 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L525 `archive_any_channel(channel_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L559 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L580 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L601 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L656 `health(admin: SessionUser=Depends(require_admin))` (function)
- L701 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L729 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L788 `revoke_webhook(webhook_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
