---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T17:27:50'
updated: '2026-08-24T17:27:50'
---

# apps/api/src/blob_api/services/workspaces.py

Symbols in `apps/api/src/blob_api/services/workspaces.py`.

- L34 `slugify(name: str)` (function)
- L40 `Founded` (class)
- L46 `is_instance_admin(session: AsyncSession, email: str)` (function) — Whether this person administers the server, as opposed to a workspace on it.
- L56 `grant_instance_admin(session: AsyncSession, email: str)` (function)
- L68 `for_email(session: AsyncSession, email: str)` (function) — Every workspace this person has a live account in, oldest first.
- L95 `_free_slug(session: AsyncSession, wanted: str)` (function) — `acme`, then `acme-2`, `acme-3`… — slugs are unique across the whole server.
- L117 `password_hash_for(session: AsyncSession, email: str)` (function) — This person's password, from whichever of their rows still has one.
- L140 `set_password_everywhere(session: AsyncSession, email: str, password_hash: str)` (function) — Write a new password to every row this person has.
- L153 `found(session: AsyncSession, *, name: str, email: str, display_name: str, password_hash: str | None, grant_admin: bool=False)` (function) — Create a workspace with its founder, their default channels, and nothing else.
- L215 `user_row_in(session: AsyncSession, workspace_id: str, email: str)` (function) — This person's account in one workspace, or 404 if they have none there.
- L240 `add_person(session: AsyncSession, *, workspace_id: str, email: str, display_name: str, role: str='member')` (function) — Put an existing person into another workspace, carrying their password across.
