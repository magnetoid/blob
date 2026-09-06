---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T03:24:47'
updated: '2026-09-06T03:24:47'
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
- L452 `Reaction` (class)
- L469 `Attachment` (class)
- L501 `CustomEmoji` (class)
- L516 `ReadState` (class)
- L531 `ThreadSubscription` (class)
- L549 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L590 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L617 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L673 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L775 `AgentState` (class) — What an agent knew at the end of its last run in a conversation.
- L798 `WorkItem` (class) — One assignment, living in a private channel spun from a conversation. ADR 0014.
- L837 `WorkArtifact` (class) — Something made in a work channel: a diff, a page, a document. Text, capped, data.
- L864 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L902 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L967 `ThreadSummary` (class)
- L1008 `MessageTranslation` (class)
- L1035 `AgentTask` (class)
- L1094 `PushSubscription` (class)
- L1108 `Webhook` (class)
- L1127 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L1155 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1245 `PluginCommand` (class) — A slash command an app provides.
- L1271 `PluginSecret` (class)
- L1281 `PluginGrant` (class)
- L1295 `AgentDelegation` (class) — Somebody the owner has let command their agent.
- L1342 `BotToken` (class)
- L1356 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1388 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
