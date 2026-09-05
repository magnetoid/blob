---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
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
- L118 `BrowsableChannel` (class) — A public channel as the directory lists it.
- L137 `ScheduledMessage` (class) — A message waiting to be sent. Only ever the author's own.
- L156 `Membership` (class)
- L162 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L171 `Attachment` (class)
- L182 `Reaction` (class)
- L188 `LinkPreview` (class)
- L196 `Message` (class)
- L226 `CustomEmoji` (class)
- L231 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L244 `ThemeSummary` (class)
- L254 `ThreadSummaryDecision` (class)
- L259 `ThreadSummaryActionItem` (class)
- L265 `ThreadSummary` (class)
- L281 `AgentTask` (class)
- L301 `MessageTranslation` (class)
- L314 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L324 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L351 `ReadStateOut` (class)
- L357 `FeedbackTicket` (class)
