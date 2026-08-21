---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:46:45'
updated: '2026-08-21T03:46:45'
---

# apps/api/src/blob_api/routers/files.py

Symbols in `apps/api/src/blob_api/routers/files.py`.

- L45 `UploadTicket` (class)
- L52 `OkOut` (class)
- L57 `create_upload(payload: UploadRequestInput, user: SessionUser=Depends(current_user))` (function) — Step 1: ask for somewhere to put the file.
- L99 `complete_upload(attachment_id: str, payload: UploadCompleteInput | None=None, user: SessionUser=Depends(current_user))` (function) — Step 2: tell us the upload finished (and, for images, how big it is).
- L134 `download(object_key: str, user: SessionUser=Depends(current_user))` (function) — Stable download URL.
