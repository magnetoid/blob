---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/schemas/models.py

Symbols in `apps/api/src/blob_api/schemas/models.py`.

- L18 `UserPrefs` (class)
- L36 `User` (class) — Public shape of a user. Never includes password_hash or another user's email.
- L52 `CurrentUser` (class) — The signed-in user sees more of themselves than of others.
- L59 `Workspace` (class)
- L66 `Channel` (class)
- L81 `Membership` (class)
- L87 `ChannelWithState` (class) — A channel as it appears in the sidebar, with this user's own state folded in.
- L96 `Attachment` (class)
- L107 `Reaction` (class)
- L113 `LinkPreview` (class)
- L121 `Message` (class)
- L144 `CustomEmoji` (class)
- L149 `ThemeSummary` (class)
- L159 `Bootstrap` (class) — Everything the client needs on boot, in one round trip.
- L170 `ReadStateOut` (class)
