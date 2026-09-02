---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:31'
updated: '2026-09-02T05:36:31'
---

# apps/api/src/blob_api/routers/files.py

Symbols in `apps/api/src/blob_api/routers/files.py`.

- L45 `UploadTicket` (class)
- L52 `OkOut` (class)
- L57 `create_upload(payload: UploadRequestInput, user: SessionUser=Depends(current_user))` (function) — Step 1: ask for somewhere to put the file.
- L99 `complete_upload(attachment_id: IdParam, payload: UploadCompleteInput | None=None, user: SessionUser=Depends(current_user))` (function) — Step 2: tell us the upload finished (and, for images, how big it is).
- L134 `download(object_key: str, user: SessionUser=Depends(current_user))` (function) — Stable download URL.
- L192 `_redirect(url: str)` (function) — The 302 itself is cacheable even though the presigned URL behind it expires.
