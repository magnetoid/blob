---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T02:51:23'
updated: '2026-09-02T02:51:23'
---

# apps/api/src/blob_api/schemas/models.py

Symbols in `apps/api/src/blob_api/schemas/models.py`.

- L21 `QuietHours` (class) — When not to interrupt somebody.
- L44 `_real_days(cls, value: list[int])` (method)
- L50 `UserPrefs` (class)
- L70 `User` (class) — Public shape of a user. Never includes password_hash or another user's email.
- L87 `CurrentUser` (class) — The signed-in user sees more of themselves than of others.
- L94 `Workspace` (class)
- L101 `Channel` (class)
- L116 `BrowsableChannel` (class) — A public channel as the directory lists it.
- L135 `ScheduledMessage` (class) — A message waiting to be sent. Only ever the author's own.
- L148 `Membership` (class)
- L154 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L163 `Attachment` (class)
- L174 `Reaction` (class)
- L180 `LinkPreview` (class)
- L188 `Message` (class)
- L218 `CustomEmoji` (class)
- L223 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L236 `ThemeSummary` (class)
- L246 `ThreadSummaryDecision` (class)
- L251 `ThreadSummaryActionItem` (class)
- L257 `ThreadSummary` (class)
- L273 `AgentTask` (class)
- L293 `MessageTranslation` (class)
- L306 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L316 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L339 `ReadStateOut` (class)
- L345 `FeedbackTicket` (class)
