---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T22:36:29'
updated: '2026-08-24T22:36:29'
---

# apps/api/src/blob_api/db/models.py

Symbols in `apps/api/src/blob_api/db/models.py`.

- L42 `Base` (class)
- L46 `_now()` (function)
- L50 `Workspace` (class)
- L59 `User` (class)
- L110 `InstanceAdmin` (class) — A person who administers the server itself, rather than a workspace on it.
- L124 `Session` (class)
- L143 `Invite` (class)
- L170 `AuditEvent` (class) — Append-only record of who did what. Written by every admin mutation.
- L198 `WorkspaceSettings` (class)
- L213 `PasswordReset` (class)
- L226 `Channel` (class)
- L268 `ChannelMember` (class)
- L293 `Message` (class)
- L368 `Reaction` (class)
- L385 `Attachment` (class)
- L414 `CustomEmoji` (class)
- L429 `ReadState` (class)
- L444 `ThreadSubscription` (class)
- L462 `ThreadSummary` (class)
- L503 `MessageTranslation` (class)
- L530 `AgentTask` (class)
- L589 `PushSubscription` (class)
- L603 `Webhook` (class)
- L622 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L650 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L707 `PluginCommand` (class) — A slash command an app provides.
- L733 `PluginSecret` (class)
- L743 `PluginGrant` (class)
- L757 `BotToken` (class)
- L771 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L803 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
