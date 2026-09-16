---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T02:35:20'
updated: '2026-09-16T02:35:20'
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
- L460 `Reaction` (class)
- L477 `Attachment` (class)
- L527 `CustomEmoji` (class)
- L542 `ReadState` (class)
- L557 `ThreadSubscription` (class)
- L575 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L616 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L643 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L699 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L801 `AgentState` (class) — What an agent knew at the end of its last run in a conversation.
- L824 `WorkItem` (class) — One assignment, living in a private channel spun from a conversation. ADR 0014.
- L863 `WorkArtifact` (class) — Something made in a work channel: a diff, a page, a document. Text, capped, data.
- L890 `ActivityEvent` (class) — Something that happened to you, stored so later kinds have a home.
- L947 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L985 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L1050 `ThreadSummary` (class)
- L1091 `MessageTranslation` (class)
- L1118 `AgentTask` (class)
- L1177 `PushSubscription` (class)
- L1191 `Meetup` (class)
- L1215 `Webhook` (class)
- L1234 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L1262 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1369 `PluginCommand` (class) — A slash command an app provides.
- L1395 `PluginSecret` (class)
- L1405 `PluginGrant` (class)
- L1419 `AgentDelegation` (class) — Somebody the owner has let command their agent.
- L1466 `BotToken` (class)
- L1480 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1512 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
- L1551 `McpToken` (class) — A person's own assistant, holding their permissions from outside the browser.
