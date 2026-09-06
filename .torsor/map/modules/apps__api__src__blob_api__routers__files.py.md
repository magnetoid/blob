---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/routers/files.py

Symbols in `apps/api/src/blob_api/routers/files.py`.

- L56 `UploadTicket` (class)
- L63 `OkOut` (class)
- L68 `create_upload(payload: UploadRequestInput, user: SessionUser=Depends(current_user))` (function) — Step 1: ask for somewhere to put the file.
- L110 `complete_upload(attachment_id: IdParam, payload: UploadCompleteInput | None=None, user: SessionUser=Depends(current_user))` (function) — Step 2: tell us the upload finished (and, for images, how big it is).
- L191 `download(object_key: str, user: SessionUser=Depends(current_user))` (function) — Stable download URL.
- L255 `_redirect(url: str)` (function) — The 302 itself is cacheable even though the presigned URL behind it expires.
