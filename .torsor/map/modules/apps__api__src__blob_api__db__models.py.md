---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:30'
updated: '2026-09-02T05:36:30'
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
- L735 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L800 `ThreadSummary` (class)
- L841 `MessageTranslation` (class)
- L868 `AgentTask` (class)
- L927 `PushSubscription` (class)
- L941 `Webhook` (class)
- L960 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L988 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1065 `PluginCommand` (class) — A slash command an app provides.
- L1091 `PluginSecret` (class)
- L1101 `PluginGrant` (class)
- L1115 `BotToken` (class)
- L1129 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1161 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
