---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T05:52:32'
updated: '2026-08-21T05:52:32'
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
- L150 `CustomEmoji` (class)
- L155 `ThemeSummary` (class)
- L165 `ThreadSummaryDecision` (class)
- L170 `ThreadSummaryActionItem` (class)
- L176 `ThreadSummary` (class)
- L192 `AgentTask` (class)
- L212 `MessageTranslation` (class)
- L225 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L236 `ReadStateOut` (class)
- L242 `FeedbackTicket` (class)
