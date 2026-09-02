---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:19'
updated: '2026-09-02T05:49:19'
---

# apps/api/src/blob_api/lib/redis.py

Symbols in `apps/api/src/blob_api/lib/redis.py`.

- L23 `presence_key(user_id: str)` (function)
- L27 `presence_conns_key(user_id: str)` (function) — The set of live connection ids a user holds, across every app process.
- L32 `focus_key(user_id: str)` (function) — Hash of connection id -> the channel that connection is looking at.
- L37 `typing_key(channel_id: str, user_id: str)` (function)
- L41 `rate_key(bucket: str, subject: str)` (function)
- L45 `close_redis()` (function)
