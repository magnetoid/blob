---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T01:21:53'
updated: '2026-08-21T01:21:53'
---

# apps/api/src/blob_api/lib/storage.py

Symbols in `apps/api/src/blob_api/lib/storage.py`.

- L29 `_build(endpoint: str)` (function)
- L44 `_client()` (function) — For the server's own reads and writes, over whatever network reaches the bucket.
- L50 `_signing_client()` (function) — For presigning, which is different.
- L62 `is_inline_image(mime: str)` (function)
- L66 `build_object_key(workspace_id: str, filename: str)` (function) — Server chooses keys so a client can never overwrite someone else's object.
- L73 `presign_upload(key: str, mime: str)` (function)
- L82 `presign_download(key: str, filename: str | None=None, mime: str | None=None)` (function)
- L99 `public_file_url(key: str)` (function) — Stable URL that routes through the API, which redirects to a fresh presigned GET.
- L108 `delete_object(key: str)` (function)
- L112 `put_object(key: str, body: bytes, mime: str)` (function)
