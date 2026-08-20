---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/routers/files.py

Symbols in `apps/api/src/blob_api/routers/files.py`.

- L45 `UploadTicket` (class)
- L52 `OkOut` (class)
- L57 `create_upload(payload: UploadRequestInput, user: SessionUser=Depends(current_user))` (function) — Step 1: ask for somewhere to put the file.
- L98 `complete_upload(attachment_id: str, payload: UploadCompleteInput | None=None, user: SessionUser=Depends(current_user))` (function) — Step 2: tell us the upload finished (and, for images, how big it is).
- L133 `download(object_key: str, user: SessionUser=Depends(current_user))` (function) — Stable download URL.
