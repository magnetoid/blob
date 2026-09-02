---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:31'
updated: '2026-09-02T05:36:31'
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
- L154 `Membership` (class)
- L160 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L169 `Attachment` (class)
- L180 `Reaction` (class)
- L186 `LinkPreview` (class)
- L194 `Message` (class)
- L224 `CustomEmoji` (class)
- L229 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L242 `ThemeSummary` (class)
- L252 `ThreadSummaryDecision` (class)
- L257 `ThreadSummaryActionItem` (class)
- L263 `ThreadSummary` (class)
- L279 `AgentTask` (class)
- L299 `MessageTranslation` (class)
- L312 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L322 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L349 `ReadStateOut` (class)
- L355 `FeedbackTicket` (class)
