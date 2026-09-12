---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T20:32:04'
updated: '2026-09-12T20:32:04'
---

# apps/api/src/blob_api/services/admin.py

Symbols in `apps/api/src/blob_api/services/admin.py`.

- L58 `_now_iso()` (function)
- L62 `_user_row(session: AsyncSession, user_id: str)` (function)
- L74 `list_users(session: AsyncSession, workspace_id: str, *, q: str | None, include_deactivated: bool, limit: int)` (function)
- L139 `set_role(session: AsyncSession, owner: Actor, user_id: str, role: str)` (function) — Only an owner changes roles, and ownership transfers rather than duplicates.
- L183 `deactivate(session: AsyncSession, admin: Actor, user_id: str)` (function)
- L212 `reactivate(session: AsyncSession, admin: Actor, user_id: str)` (function)
- L243 `revoke_sessions(session: AsyncSession, admin: Actor, user_id: str)` (function) — Sign someone out of every device without disabling their account.
- L261 `create_reset_link(session: AsyncSession, admin: Actor, user_id: str)` (function) — Mint a password-reset link for somebody, for an admin to hand over.
- L319 `list_invites(session: AsyncSession, workspace_id: str)` (function)
- L368 `revoke_invite(session: AsyncSession, admin: Actor, invite_id: str)` (function)
- L391 `list_channels(session: AsyncSession, workspace_id: str)` (function) — Every channel, including private ones the admin is not a member of.
- L433 `_set_archived(session: AsyncSession, admin: Actor, channel_id: str, *, archived: bool)` (function)
- L460 `archive_channel(session: AsyncSession, admin: Actor, channel_id: str)` (function)
- L464 `unarchive_channel(session: AsyncSession, admin: Actor, channel_id: str)` (function) — Reopen an archived channel, and return it as the admin sees it.
- L481 `get_settings(session: AsyncSession, workspace_id: str)` (function)
- L500 `update_settings(session: AsyncSession, admin: Actor, payload: SettingsInput)` (function)
- L538 `list_deliveries(session: AsyncSession, workspace_id: str, *, limit: int)` (function) — Every app's recent deliveries, for the console log.
- L583 `usage_counts(session: AsyncSession, workspace_id: str)` (function) — Messages kept and bytes stored, for the health card.
- L606 `list_webhooks(session: AsyncSession, workspace_id: str)` (function)
- L632 `create_webhook(session: AsyncSession, admin: Actor, payload: CreateWebhookInput)` (function) — The URL comes back once. The raw token is never recoverable afterwards.
- L685 `revoke_webhook(session: AsyncSession, admin: Actor, webhook_id: str)` (function)
