---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T05:53:40'
updated: '2026-09-06T05:53:40'
---

# apps/api/src/blob_api/schemas/models.py

Symbols in `apps/api/src/blob_api/schemas/models.py`.

- L21 `QuietHours` (class) — When not to interrupt somebody.
- L44 `_real_days(cls, value: list[int])` (method)
- L50 `UserPrefs` (class)
- L73 `User` (class) — Public shape of a user. Never includes password_hash or another user's email.
- L90 `CurrentUser` (class) — The signed-in user sees more of themselves than of others.
- L97 `Workspace` (class)
- L104 `Channel` (class)
- L123 `BrowsableChannel` (class) — A public channel as the directory lists it.
- L142 `ScheduledMessage` (class) — A message waiting to be sent. Only ever the author's own.
- L161 `Membership` (class)
- L167 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L176 `Attachment` (class)
- L187 `Reaction` (class)
- L193 `LinkPreview` (class)
- L201 `Message` (class)
- L231 `CustomEmoji` (class)
- L236 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L249 `ThemeSummary` (class)
- L259 `ThreadSummaryDecision` (class)
- L264 `ThreadSummaryActionItem` (class)
- L270 `ThreadSummaryOpenQuestion` (class) — A question the thread never answered, pointing at the message that asked it.
- L283 `ThreadSummary` (class)
- L301 `AgentTask` (class)
- L321 `MessageTranslation` (class)
- L334 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L344 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L371 `ReadStateOut` (class)
- L377 `FeedbackTicket` (class)
