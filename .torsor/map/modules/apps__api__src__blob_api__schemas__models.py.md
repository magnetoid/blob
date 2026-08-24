---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T16:51:20'
updated: '2026-08-24T16:51:20'
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
- L154 `CustomEmoji` (class)
- L159 `CommandSpec` (class) — One slash command, as the composer's autocomplete needs to describe it.
- L172 `ThemeSummary` (class)
- L182 `ThreadSummaryDecision` (class)
- L187 `ThreadSummaryActionItem` (class)
- L193 `ThreadSummary` (class)
- L209 `AgentTask` (class)
- L229 `MessageTranslation` (class)
- L242 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L254 `ReadStateOut` (class)
- L260 `FeedbackTicket` (class)
