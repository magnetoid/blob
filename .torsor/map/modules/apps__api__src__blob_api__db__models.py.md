---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
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
- L448 `PushSubscription` (class)
- L462 `Webhook` (class)
- L481 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L509 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L552 `PluginSecret` (class)
- L562 `PluginGrant` (class)
- L576 `BotToken` (class)
- L590 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
