---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T13:47:06'
updated: '2026-09-06T13:47:06'
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
- L319 `UnansweredNudge` (class) — One row per question the nudge sweep has acted on — the once-only ratchet.
- L346 `ChannelMember` (class)
- L371 `Message` (class)
- L454 `Reaction` (class)
- L471 `Attachment` (class)
- L503 `CustomEmoji` (class)
- L518 `ReadState` (class)
- L533 `ThreadSubscription` (class)
- L551 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L592 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L619 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L675 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L777 `AgentState` (class) — What an agent knew at the end of its last run in a conversation.
- L800 `WorkItem` (class) — One assignment, living in a private channel spun from a conversation. ADR 0014.
- L839 `WorkArtifact` (class) — Something made in a work channel: a diff, a page, a document. Text, capped, data.
- L866 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L904 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L969 `ThreadSummary` (class)
- L1010 `MessageTranslation` (class)
- L1037 `AgentTask` (class)
- L1096 `PushSubscription` (class)
- L1110 `Webhook` (class)
- L1129 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L1157 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1247 `PluginCommand` (class) — A slash command an app provides.
- L1273 `PluginSecret` (class)
- L1283 `PluginGrant` (class)
- L1297 `AgentDelegation` (class) — Somebody the owner has let command their agent.
- L1344 `BotToken` (class)
- L1358 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1390 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
