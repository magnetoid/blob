---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/lib/images.py

Symbols in `apps/api/src/blob_api/lib/images.py`.

- L52 `Rendered` (class) — A thumbnail, and the true size of what it was made from.
- L63 `can_thumbnail(mime: str, size_bytes: int)` (function)
- L67 `render(data: bytes)` (function) — A thumbnail for `data`, or None if it is not an image we can read.
- L99 `thumb_key_for(object_key: str)` (function) — Derived, not stored twice: the thumbnail lives beside the original.
