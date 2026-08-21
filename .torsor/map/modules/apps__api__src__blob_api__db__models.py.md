---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:03:23'
updated: '2026-08-21T06:03:23'
---

# apps/api/src/blob_api/db/models.py

Symbols in `apps/api/src/blob_api/db/models.py`.

- L42 `Base` (class)
- L46 `_now()` (function)
- L50 `Workspace` (class)
- L59 `User` (class)
- L110 `Session` (class)
- L129 `Invite` (class)
- L156 `AuditEvent` (class) — Append-only record of who did what. Written by every admin mutation.
- L184 `WorkspaceSettings` (class)
- L199 `PasswordReset` (class)
- L212 `Channel` (class)
- L254 `ChannelMember` (class)
- L279 `Message` (class)
- L354 `Reaction` (class)
- L371 `Attachment` (class)
- L400 `CustomEmoji` (class)
- L415 `ReadState` (class)
- L430 `ThreadSubscription` (class)
- L448 `ThreadSummary` (class)
- L489 `MessageTranslation` (class)
- L516 `AgentTask` (class)
- L579 `PushSubscription` (class)
- L593 `Webhook` (class)
- L612 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L640 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L683 `PluginSecret` (class)
- L693 `PluginGrant` (class)
- L707 `BotToken` (class)
- L721 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L755 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
