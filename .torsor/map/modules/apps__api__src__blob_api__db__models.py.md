---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T23:40:19'
updated: '2026-09-15T23:40:19'
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
- L271 `PasswordReset` (class)
- L284 `Channel` (class)
- L331 `UnansweredNudge` (class) — One row per question the nudge sweep has acted on — the once-only ratchet.
- L358 `ChannelMember` (class)
- L383 `Message` (class)
- L472 `Reaction` (class)
- L489 `Attachment` (class)
- L539 `CustomEmoji` (class)
- L554 `ReadState` (class)
- L569 `ThreadSubscription` (class)
- L587 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L628 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L655 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L711 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L813 `AgentState` (class) — What an agent knew at the end of its last run in a conversation.
- L836 `WorkItem` (class) — One assignment, living in a private channel spun from a conversation. ADR 0014.
- L875 `WorkArtifact` (class) — Something made in a work channel: a diff, a page, a document. Text, capped, data.
- L902 `ActivityEvent` (class) — Something that happened to you, stored so later kinds have a home.
- L959 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L997 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L1062 `ThreadSummary` (class)
- L1103 `MessageTranslation` (class)
- L1130 `AgentTask` (class)
- L1189 `PushSubscription` (class)
- L1203 `Meetup` (class)
- L1227 `Webhook` (class)
- L1246 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L1274 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1381 `PluginCommand` (class) — A slash command an app provides.
- L1407 `PluginSecret` (class)
- L1417 `PluginGrant` (class)
- L1431 `AgentDelegation` (class) — Somebody the owner has let command their agent.
- L1478 `BotToken` (class)
- L1492 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1524 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
- L1563 `McpToken` (class) — A person's own assistant, holding their permissions from outside the browser.
