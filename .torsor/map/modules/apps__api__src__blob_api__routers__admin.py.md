---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/admin.py

Symbols in `apps/api/src/blob_api/routers/admin.py`.

- L49 `AuditOut` (class)
- L53 `_user_updated(workspace_id: str, user: User)` (function)
- L59 `list_users(q: str | None=None, include_deactivated: bool=True, limit: Annotated[int, Query(ge=1, le=200)]=100, admin: SessionUser=Depends(require_admin))` (function)
- L79 `set_role(user_id: IdParam, payload: RoleInput, request: Request, owner: SessionUser=Depends(require_owner))` (function)
- L99 `deactivate(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L115 `reactivate(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L126 `revoke_sessions(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Sign someone out of every device without disabling their account.
- L137 `create_reset_link(user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a password-reset link for somebody, for an admin to hand over.
- L147 `list_invites(admin: SessionUser=Depends(require_admin))` (function)
- L153 `revoke_invite(invite_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L163 `list_all_channels(admin: SessionUser=Depends(require_admin))` (function) — Every channel, including private ones the admin is not a member of.
- L170 `archive_any_channel(channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L182 `unarchive_any_channel(channel_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Reopen an archived channel.
- L201 `audit_log(actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function)
- L222 `get_settings(admin: SessionUser=Depends(require_admin))` (function)
- L228 `update_settings(payload: SettingsInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L236 `list_workspace_deliveries(limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — Every app's recent deliveries, for the console log.
- L246 `health(admin: SessionUser=Depends(require_admin))` (function) — Each dependency probed on its own, so one being down does not hide the others.
- L282 `list_webhooks(admin: SessionUser=Depends(require_admin))` (function)
- L288 `create_webhook(payload: CreateWebhookInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L297 `revoke_webhook(webhook_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
