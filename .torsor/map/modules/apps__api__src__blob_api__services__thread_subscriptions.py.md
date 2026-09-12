---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T01:33:43'
updated: '2026-09-13T01:33:43'
---

# apps/api/src/blob_api/services/thread_subscriptions.py

Symbols in `apps/api/src/blob_api/services/thread_subscriptions.py`.

- L18 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads you follow, most recently active first, and which of them have new replies.
- L61 `following(session: AsyncSession, user_id: str, root_id: str)` (function) — Whether this person is following that thread.
- L77 `set_following(session: AsyncSession, user_id: str, root_id: str, following: bool)` (function) — Follow a thread, or stop.
- L106 `mark_read(session: AsyncSession, user_id: str, root_id: str)` (function) — Move the thread's read cursor to its newest reply.
