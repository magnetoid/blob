---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T16:15:58'
updated: '2026-08-25T16:15:58'
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
- L408 `Reaction` (class)
- L425 `Attachment` (class)
- L454 `CustomEmoji` (class)
- L469 `ReadState` (class)
- L484 `ThreadSubscription` (class)
- L502 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L543 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L570 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L628 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L684 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L706 `ThreadSummary` (class)
- L747 `MessageTranslation` (class)
- L774 `AgentTask` (class)
- L833 `PushSubscription` (class)
- L847 `Webhook` (class)
- L866 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L894 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L951 `PluginCommand` (class) — A slash command an app provides.
- L977 `PluginSecret` (class)
- L987 `PluginGrant` (class)
- L1001 `BotToken` (class)
- L1015 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1047 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
