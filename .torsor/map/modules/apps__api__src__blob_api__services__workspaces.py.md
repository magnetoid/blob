---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:21:53'
updated: '2026-09-02T05:21:53'
---

# apps/api/src/blob_api/services/workspaces.py

Symbols in `apps/api/src/blob_api/services/workspaces.py`.

- L35 `slugify(name: str)` (function)
- L41 `Founded` (class)
- L47 `grant_instance_admin(session: AsyncSession, email: str)` (function)
- L59 `for_email(session: AsyncSession, email: str)` (function) — Every workspace this person has a live account in, oldest first.
- L86 `_free_slug(session: AsyncSession, wanted: str)` (function) — `acme`, then `acme-2`, `acme-3`… — slugs are unique across the whole server.
- L108 `password_hash_for(session: AsyncSession, email: str)` (function) — This person's password, from whichever of their rows still has one.
- L131 `set_password_everywhere(session: AsyncSession, email: str, password_hash: str)` (function) — Write a new password to every row this person has.
- L144 `found(session: AsyncSession, *, name: str, email: str, display_name: str, password_hash: str | None, grant_admin: bool=False)` (function) — Create a workspace with its founder, their default channels, and nothing else.
- L216 `user_row_in(session: AsyncSession, workspace_id: str, email: str)` (function) — This person's account in one workspace, or 404 if they have none there.
