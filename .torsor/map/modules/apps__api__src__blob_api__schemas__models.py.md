---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/schemas/models.py

Symbols in `apps/api/src/blob_api/schemas/models.py`.

- L21 `UserPrefs` (class)
- L41 `User` (class) — Public shape of a user. Never includes password_hash or another user's email.
- L58 `CurrentUser` (class) — The signed-in user sees more of themselves than of others.
- L65 `Workspace` (class)
- L72 `Channel` (class)
- L87 `Membership` (class)
- L93 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L102 `Attachment` (class)
- L113 `Reaction` (class)
- L119 `LinkPreview` (class)
- L127 `Message` (class)
- L157 `CustomEmoji` (class)
- L162 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L175 `ThemeSummary` (class)
- L185 `ThreadSummaryDecision` (class)
- L190 `ThreadSummaryActionItem` (class)
- L196 `ThreadSummary` (class)
- L212 `AgentTask` (class)
- L232 `MessageTranslation` (class)
- L245 `UserGroup` (class) — A named set of people, mentionable as one handle.
- L255 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L278 `ReadStateOut` (class)
- L284 `FeedbackTicket` (class)
