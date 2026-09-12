---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/routers/files.py

Symbols in `apps/api/src/blob_api/routers/files.py`.

- L63 `UploadTicket` (class)
- L70 `OkOut` (class)
- L74 `FileEntry` (class)
- L80 `FileListOut` (class)
- L85 `_file_entry(row: Any)` (function)
- L105 `list_attachments(user: SessionUser=Depends(current_user), channel_id: str | None=Query(None, alias='channelId'), kind: str=Query('all'), cursor: str | None=None, limit: int=Query(40, ge=1, le=100))` (function) — Files posted in channels this person can see, newest first.
- L189 `create_upload(payload: UploadRequestInput, user: SessionUser=Depends(current_user))` (function) — Step 1: ask for somewhere to put the file.
- L234 `complete_upload(attachment_id: IdParam, payload: UploadCompleteInput | None=None, user: SessionUser=Depends(current_user))` (function) — Step 2: tell us the upload finished (and, for images, how big it is).
- L350 `download(object_key: str, user: SessionUser=Depends(current_user))` (function) — Stable download URL.
- L414 `_redirect(url: str)` (function) — The 302 itself is cacheable even though the presigned URL behind it expires.
