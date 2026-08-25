---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
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
- L496 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L518 `ThreadSummary` (class)
- L559 `MessageTranslation` (class)
- L586 `AgentTask` (class)
- L645 `PushSubscription` (class)
- L659 `Webhook` (class)
- L678 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L706 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L763 `PluginCommand` (class) — A slash command an app provides.
- L789 `PluginSecret` (class)
- L799 `PluginGrant` (class)
- L813 `BotToken` (class)
- L827 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L859 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
