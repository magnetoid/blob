---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:19'
updated: '2026-09-23T03:37:19'
---

# apps/api/src/blob_api/db/models.py

Symbols in `apps/api/src/blob_api/db/models.py`.

- L43 `Base` (class)
- L47 `_now()` (function)
- L51 `Workspace` (class)
- L60 `User` (class)
- L117 `InstanceAdmin` (class) — A person who administers the server itself, rather than a workspace on it.
- L131 `Session` (class)
- L150 `Invite` (class)
- L177 `AuditEvent` (class) — Append-only record of who did what. Written by every admin mutation.
- L205 `WorkspaceSettings` (class)
- L220 `WorkspacePolicy` (class) — What one workspace may do to the machine it runs on.
- L260 `PasswordReset` (class)
- L273 `Channel` (class)
- L320 `UnansweredNudge` (class) — One row per question the nudge sweep has acted on — the once-only ratchet.
- L347 `ChannelMember` (class)
- L372 `Message` (class)
- L461 `Reaction` (class)
- L478 `Attachment` (class)
- L537 `CustomEmoji` (class)
- L552 `ReadState` (class)
- L567 `ThreadSubscription` (class)
- L585 `UserGroup` (class) — A named set of people, mentionable as one handle. Slack's user groups.
- L626 `UserGroupMember` (class) — Who is in a group, and whether they have muted it.
- L653 `WorkspaceHandle` (class) — Every mentionable name in a workspace, in one place, decided by one index.
- L709 `AgentRun` (class) — One attempt by an agent to answer a mention.
- L811 `AgentState` (class) — What an agent knew at the end of its last run in a conversation.
- L834 `WorkItem` (class) — One assignment, living in a private channel spun from a conversation. ADR 0014.
- L873 `WorkArtifact` (class) — Something made in a work channel: a diff, a page, a document. Text, capped, data.
- L900 `ActivityEvent` (class) — Something that happened to you, stored so later kinds have a home.
- L957 `SavedItem` (class) — A message somebody put aside for themselves. Slack's Later.
- L995 `ScheduledMessage` (class) — A message written now and sent later. Slack's "Schedule message".
- L1060 `ThreadSummary` (class)
- L1101 `MessageTranslation` (class)
- L1128 `AgentTask` (class)
- L1187 `PushSubscription` (class)
- L1201 `Call` (class) — A LiveKit room that belongs to one conversation — a huddle or a meetup.
- L1238 `CallParticipant` (class) — Somebody connected to a call right now. Deleted when they leave, and with the call.
- L1253 `Webhook` (class)
- L1272 `Theme` (class) — Added by 003. A named set of token overrides on the built-in palette.
- L1300 `Plugin` (class) — An installed app. One row whether it runs in-process or over HTTP.
- L1415 `PluginCommand` (class) — A slash command an app provides.
- L1441 `PluginSecret` (class)
- L1451 `PluginGrant` (class)
- L1465 `AgentDelegation` (class) — Somebody the owner has let command their agent.
- L1512 `BotToken` (class)
- L1526 `PluginDelivery` (class) — The outbox. Written in the transaction that caused the event, drained by the worker.
- L1558 `FeedbackTicket` (class) — Added by 0007. A bug report, feature request or note, with its diagnostics.
- L1597 `McpToken` (class) — A person's own assistant, holding their permissions from outside the browser.
