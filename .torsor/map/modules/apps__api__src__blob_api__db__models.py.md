---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T01:55:20'
updated: '2026-08-25T01:55:20'
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
- L213 `WorkspacePolicy` (class) — What one workspace may do to the machine it runs on.
- L247 `PasswordReset` (class)
- L260 `Channel` (class)
- L302 `ChannelMember` (class)
- L327 `Message` (class)
- L402 `Reaction` (class)
- L419 `Attachment` (class)
- L448 `CustomEmoji` (class)
- L463 `ReadState` (class)
- L478 `ThreadSubscription` (class)
- L496 `ThreadSummary` (class)
- L537 `MessageTranslation` (class)
- L564 `AgentTask` (class)
- L623 `PushSubscription` (class)
- L637 `Webhook` (class)
- L656 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L684 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L741 `PluginCommand` (class) — A slash command an app provides.
- L767 `PluginSecret` (class)
- L777 `PluginGrant` (class)
- L791 `BotToken` (class)
- L805 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L837 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
