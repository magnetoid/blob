---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T00:56:13'
updated: '2026-09-13T00:56:13'
---

# apps/api/src/blob_api/services/mcp_tokens.py

Symbols in `apps/api/src/blob_api/services/mcp_tokens.py`.

- L23 `_actor(user: SessionUser)` (function)
- L27 `list_for(session: AsyncSession, user_id: str)` (function) — This person's live tokens, newest first. Revoked ones are gone from the list.
- L46 `mint(session: AsyncSession, user: SessionUser, *, name: str, can_write: bool)` (function) — A new token for this person. Returns the row and the secret, shown once.
- L85 `revoke(session: AsyncSession, user: SessionUser, token_id: str)` (function) — Scoped to the owner, so a token id learned from somewhere else revokes nothing.
