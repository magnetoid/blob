---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/services/files.py

Symbols in `apps/api/src/blob_api/services/files.py`.

- L22 `listing(session: AsyncSession, user: SessionUser, *, channel_id: str | None, kind: str, cursor: str | None, limit: int)` (function) — Files posted in channels this person can see, newest first, keyset-paged.
- L102 `open_ticket(session: AsyncSession, user: SessionUser, *, attachment_id: str, object_key: str, filename: str, mime: str, size_bytes: int, kind: str='file')` (function) — The row an upload ticket is written against, before any byte has moved.
- L135 `own_upload(session: AsyncSession, attachment_id: str, uploader_id: str)` (function) — An upload as its uploader sees it; None when it is not theirs or is gone.
- L151 `refuse_upload(session: AsyncSession, attachment_id: str, uploader_id: str)` (function)
- L158 `mark_uploaded(session: AsyncSession, attachment_id: str, uploader_id: str, *, width: int | None, height: int | None, thumb_key: str | None, duration_ms: int | None=None, waveform: list[int] | None=None)` (function) — Record that the bytes arrived. False when the row is not this uploader's.
- L199 `for_download(session: AsyncSession, user: SessionUser, key: str)` (function) — The attachment behind a stored key, with whether this person is in its channel.
- L224 `is_shared_picture(session: AsyncSession, workspace_id: str, key: str)` (function) — Avatars and custom emoji are workspace-wide, whatever their upload row says.
