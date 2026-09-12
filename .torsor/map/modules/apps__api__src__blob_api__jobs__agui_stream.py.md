---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T01:33:41'
updated: '2026-09-13T01:33:41'
---

# apps/api/src/blob_api/jobs/agui_stream.py

Symbols in `apps/api/src/blob_api/jobs/agui_stream.py`.

- L20 `CardBroadcaster` (class) — Live snapshots of a run's card, at most ~4 a second.
- L29 `__init__(self, run_id: str, channel_id: str, card: run_card.CardFold)` (method)
- L36 `on_event(self, event: Mapping[str, Any])` (method)
- L43 `_flush_loop(self)` (method)
- L59 `stop(self)` (method)
- L67 `wait_for_cancel(pubsub: Any)` (function) — Returns when a cancel is published for this run. Runs until cancelled itself.
