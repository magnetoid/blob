---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T23:39:48'
updated: '2026-09-01T23:39:48'
---

# apps/api/src/blob_api/lib/sse.py

Symbols in `apps/api/src/blob_api/lib/sse.py`.

- L16 `SseDecoder` (class) — Splits a `text/event-stream` byte stream into the JSON objects it carries.
- L29 `__init__(self)` (method)
- L33 `feed(self, chunk: bytes)` (method)
- L41 `close(self)` (method) — Flush whatever arrived without a trailing blank line.
- L48 `_line(self, line: str)` (method)
- L58 `_dispatch(self)` (method)
