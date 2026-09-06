---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-07T00:07:27'
updated: '2026-09-07T00:07:27'
---

# apps/api/src/blob_api/lib/webpush.py

Symbols in `apps/api/src/blob_api/lib/webpush.py`.

- L32 `PushResult` (class) — What became of a fan-out: what landed, and what the browser has thrown away.
- L42 `push(subs: Sequence[Any], payload: dict[str, Any])` (function) — Fan out web push and report honestly what happened to each subscription.
- L89 `send_push(subs: Sequence[Any], payload: dict[str, Any])` (function) — The dead-subscription ids alone, for callers that only prune.
