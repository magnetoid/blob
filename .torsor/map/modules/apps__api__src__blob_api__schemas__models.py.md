---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:51'
updated: '2026-09-01T22:51:51'
---

# apps/api/src/blob_api/schemas/models.py

Symbols in `apps/api/src/blob_api/schemas/models.py`.

- L21 `UserPrefs` (class)
- L41 `User` (class) — Public shape of a user. Never includes password_hash or another user's email.
- L58 `CurrentUser` (class) — The signed-in user sees more of themselves than of others.
- L65 `Workspace` (class)
- L72 `Channel` (class)
- L87 `BrowsableChannel` (class) — A public channel as the directory lists it.
- L106 `ScheduledMessage` (class) — A message waiting to be sent. Only ever the author's own.
- L119 `Membership` (class)
- L125 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L134 `Attachment` (class)
- L145 `Reaction` (class)
- L151 `LinkPreview` (class)
- L159 `Message` (class)
- L189 `CustomEmoji` (class)
- L194 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L207 `ThemeSummary` (class)
- L217 `ThreadSummaryDecision` (class)
- L222 `ThreadSummaryActionItem` (class)
- L228 `ThreadSummary` (class)
- L244 `AgentTask` (class)
- L264 `MessageTranslation` (class)
- L277 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L287 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L310 `ReadStateOut` (class)
- L316 `FeedbackTicket` (class)
