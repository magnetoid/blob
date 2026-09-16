---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/lib/storage.py

Symbols in `apps/api/src/blob_api/lib/storage.py`.

- L50 `_build(endpoint: str)` (function)
- L65 `_client()` (function) — For the server's own reads and writes, over whatever network reaches the bucket.
- L71 `_signing_client()` (function) — For presigning, which is different.
- L86 `ensure_bucket()` (function) — Create the bucket on first use if it is not there.
- L117 `is_inline_image(mime: str)` (function)
- L121 `build_object_key(workspace_id: str, filename: str)` (function) — Server chooses keys so a client can never overwrite someone else's object.
- L128 `presign_upload(key: str, mime: str)` (function)
- L137 `is_inline_media(mime: str, *, voice: bool=False)` (function) — Whether this type may be served inline. Audio only for a voice message.
- L142 `presign_download(key: str, filename: str | None=None, mime: str | None=None, *, voice: bool=False)` (function) — A short-lived GET, with the response's own type and disposition pinned.
- L177 `public_file_url(key: str)` (function) — Stable URL that routes through the API, which redirects to a fresh presigned GET.
- L186 `delete_object(key: str)` (function)
- L190 `get_object(key: str)` (function) — Read an object through the app rather than redirecting the browser to it.
- L201 `get_object_head(key: str, n: int=64)` (function) — The first `n` bytes, for magic-number checks that must not download a 100MB file.
- L213 `put_object(key: str, body: bytes, mime: str)` (function)
- L223 `probe()` (function) — Whether *a browser* could reach object storage — not whether this process can.
