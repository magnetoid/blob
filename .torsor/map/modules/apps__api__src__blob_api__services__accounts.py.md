---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T20:50:29'
updated: '2026-09-12T20:50:29'
---

# apps/api/src/blob_api/services/accounts.py

Symbols in `apps/api/src/blob_api/services/accounts.py`.

- L22 `find_for_login(session: AsyncSession, email: str)` (function) — The account a bare sign-in lands in.
- L47 `revoke_assistant_tokens(session: AsyncSession, user_id: str)` (function) — "Everywhere else" has to mean everywhere else.
- L63 `sessions_for(session: AsyncSession, user_id: str)` (function)
- L82 `begin_password_reset(session: AsyncSession, email: str)` (function) — Mint a reset token for this address, or nothing when no live account holds it.
- L116 `finish_password_reset(session: AsyncSession, token: str, password_hash: str)` (function) — Set the new password everywhere this address has an account.
