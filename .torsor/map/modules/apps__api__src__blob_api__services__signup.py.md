---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T20:50:30'
updated: '2026-09-12T20:50:30'
---

# apps/api/src/blob_api/services/signup.py

Symbols in `apps/api/src/blob_api/services/signup.py`.

- L30 `needs_setup(session: AsyncSession)` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L36 `_open_invite(session: AsyncSession, token: str)` (function)
- L53 `signup(session: AsyncSession, *, email: str, password: str, display_name: str, workspace_name: str | None, invite_token: str | None)` (function) — Create the account, and say whose it is.
- L204 `create_invite(session: AsyncSession, actor: Actor, *, email: str | None, role: str, expires_in_days: int)` (function) — Mint an invitation. Returns the raw token, when it expires, and the workspace name.
- L257 `preview_invite(session: AsyncSession, token: str)` (function) — What an open invitation is for: the address it names, and the workspace.
