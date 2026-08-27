---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:40'
updated: '2026-08-27T02:15:40'
---

# apps/api/src/blob_api/db/models.py

Symbols in `apps/api/src/blob_api/db/models.py`.

- L42 `Base` (class)
- L46 `_now()` (function)
- L50 `Workspace` (class)
- L59 `User` (class)
- L116 `InstanceAdmin` (class) — A person who administers the server itself, rather than a workspace on it.
- L130 `Session` (class)
- L149 `Invite` (class)
- L176 `AuditEvent` (class) — Append-only record of who did what. Written by every admin mutation.
- L204 `WorkspaceSettings` (class)
- L219 `WorkspacePolicy` (class) — What one workspace may do to the machine it runs on.
- L253 `PasswordReset` (class)
- L266 `Channel` (class)
- L308 `ChannelMember` (class)
- L333 `Message` (class)
- L414 `Reaction` (class)
- L431 `Attachment` (class)
- L463 `CustomEmoji` (class)
- L478 `ReadState` (class)
- L493 `ThreadSubscription` (class)
- L511 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L552 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L579 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L635 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L697 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L735 `ThreadSummary` (class)
- L776 `MessageTranslation` (class)
- L803 `AgentTask` (class)
- L862 `PushSubscription` (class)
- L876 `Webhook` (class)
- L895 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L923 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L980 `PluginCommand` (class) — A slash command an app provides.
- L1006 `PluginSecret` (class)
- L1016 `PluginGrant` (class)
- L1030 `BotToken` (class)
- L1044 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1076 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
