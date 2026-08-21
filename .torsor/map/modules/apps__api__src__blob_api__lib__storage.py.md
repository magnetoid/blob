---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:12:06'
updated: '2026-08-21T07:12:06'
---

# apps/api/src/blob_api/lib/storage.py

Symbols in `apps/api/src/blob_api/lib/storage.py`.

- L32 `_build(endpoint: str)` (function)
- L47 `_client()` (function) — For the server's own reads and writes, over whatever network reaches the bucket.
- L53 `_signing_client()` (function) — For presigning, which is different.
- L68 `ensure_bucket()` (function) — Create the bucket on first use if it is not there.
- L99 `is_inline_image(mime: str)` (function)
- L103 `build_object_key(workspace_id: str, filename: str)` (function) — Server chooses keys so a client can never overwrite someone else's object.
- L110 `presign_upload(key: str, mime: str)` (function)
- L119 `presign_download(key: str, filename: str | None=None, mime: str | None=None)` (function)
- L136 `public_file_url(key: str)` (function) — Stable URL that routes through the API, which redirects to a fresh presigned GET.
- L145 `delete_object(key: str)` (function)
- L149 `get_object(key: str)` (function) — Read an object through the app rather than redirecting the browser to it.
- L162 `put_object(key: str, body: bytes, mime: str)` (function)
