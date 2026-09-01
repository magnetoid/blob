---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T23:39:47'
updated: '2026-09-01T23:39:47'
---

# apps/api/src/blob_api/lib/logbuf.py

Symbols in `apps/api/src/blob_api/lib/logbuf.py`.

- L69 `_redis()` (function)
- L76 `_discard_client()` (function) — Throw the client away so the next call builds a fresh one.
- L93 `close_log_buffer()` (function) — Shutdown hook, so the process does not exit holding a socket open.
- L98 `_entry_for(record: logging.LogRecord)` (function)
- L117 `_iso(epoch: float)` (function)
- L125 `_write(payload: str)` (function) — Store one record. Never raises, and never logs — see the module docstring.
- L143 `RedisLogHandler` (class) — Copies WARNING and above into Redis. Attached to the root logger.
- L146 `emit(self, record: logging.LogRecord)` (method)
- L176 `install_log_capture()` (function) — Attach the handler to the root logger, once.
- L193 `read_logs(limit: int=100, level: str | None=None)` (function) — Newest first. A bad row is skipped rather than failing the page.
- L216 `clear_logs()` (function) — Empty the list — 'I have dealt with these', which is the only state this has.
