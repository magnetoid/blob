---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/plugins/delivery.py

Symbols in `apps/api/src/blob_api/plugins/delivery.py`.

- L61 `backoff_for(attempts: int, *, jitter: float | None=None)` (function) — Delay before the next attempt, or None when there should not be one.
- L70 `lease_due(limit: int=BATCH)` (function) — Take a batch of due deliveries and push their next attempt out.
- L128 `post(url: str, secret: str, payload: dict[str, Any], delivery_id: str)` (function) — POST one signed delivery. Returns (status code, error text); 0 means no response.
- L151 `open_client()` (function) — The one connection pool every delivery shares.
- L164 `close_client()` (function)
- L171 `_record(session: AsyncSession, delivery_id: str, status_code: int, error: str, attempts: int, plugin_id: str)` (function)
- L244 `trip_if_open(session: AsyncSession, plugin_id: str)` (function) — Park the plugin when the last few deliveries all failed.
- L278 `record_result(delivery_id: str, status_code: int, error: str, attempts: int, plugin_id: str)` (function)
- L285 `drain_once(limit: int=BATCH)` (function) — Deliver everything currently due. Returns how many were attempted.
- L314 `drain(max_passes: int=5)` (function) — Work through the backlog, stopping when it is empty or the budget is spent.
