---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/schemas/models.py

Symbols in `apps/api/src/blob_api/schemas/models.py`.

- L24 `QuietHours` (class) — When not to interrupt somebody.
- L47 `_real_days(cls, value: list[int])` (method)
- L53 `UserPrefs` (class)
- L76 `User` (class) — Public shape of a user. Never includes password_hash or another user's email.
- L98 `CurrentUser` (class) — The signed-in user sees more of themselves than of others.
- L105 `Workspace` (class)
- L112 `Channel` (class)
- L131 `BrowsableChannel` (class) — A public channel as the directory lists it.
- L150 `ScheduledMessage` (class) — A message waiting to be sent. Only ever the author's own.
- L169 `Membership` (class)
- L175 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L184 `Attachment` (class)
- L202 `Reaction` (class)
- L208 `LinkPreview` (class)
- L216 `Message` (class)
- L246 `CustomEmoji` (class)
- L251 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L264 `ThemeSummary` (class) — A theme as every caller sees it.
- L282 `ThreadSummaryDecision` (class)
- L287 `ThreadSummaryActionItem` (class)
- L293 `ThreadSummaryOpenQuestion` (class) — A question the thread never answered, pointing at the message that asked it.
- L306 `ThreadSummary` (class)
- L324 `AgentTask` (class)
- L344 `MessageTranslation` (class)
- L357 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L367 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L394 `ReadStateOut` (class)
- L400 `FeedbackTicket` (class)
- L418 `MessageOut` (class)
- L422 `MessagesOut` (class)
- L426 `MembersOut` (class)
