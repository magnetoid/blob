---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:23'
updated: '2026-09-05T04:19:23'
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
- L259 `PasswordReset` (class)
- L272 `Channel` (class)
- L314 `ChannelMember` (class)
- L339 `Message` (class)
- L420 `Reaction` (class)
- L437 `Attachment` (class)
- L469 `CustomEmoji` (class)
- L484 `ReadState` (class)
- L499 `ThreadSubscription` (class)
- L517 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L558 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L585 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L641 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L743 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L781 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L846 `ThreadSummary` (class)
- L887 `MessageTranslation` (class)
- L914 `AgentTask` (class)
- L973 `PushSubscription` (class)
- L987 `Webhook` (class)
- L1006 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L1034 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1124 `PluginCommand` (class) — A slash command an app provides.
- L1150 `PluginSecret` (class)
- L1160 `PluginGrant` (class)
- L1174 `AgentDelegation` (class) — Somebody the owner has let command their agent.
- L1221 `BotToken` (class)
- L1235 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1267 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
