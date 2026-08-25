---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T01:55:20'
updated: '2026-08-25T01:55:20'
---

# apps/api/src/blob_api/plugins/delivery.py

Symbols in `apps/api/src/blob_api/plugins/delivery.py`.

- L53 `backoff_for(attempts: int, *, jitter: float | None=None)` (function) — Delay before the next attempt, or None when there should not be one.
- L62 `lease_due(limit: int=BATCH)` (function) — Take a batch of due deliveries and push their next attempt out.
- L120 `post(url: str, secret: str, payload: dict[str, Any], delivery_id: str)` (function) — POST one signed delivery. Returns (status code, error text); 0 means no response.
- L141 `_record(session: AsyncSession, delivery_id: str, status_code: int, error: str, attempts: int)` (function)
- L207 `record_result(delivery_id: str, status_code: int, error: str, attempts: int)` (function)
- L212 `drain_once(limit: int=BATCH)` (function) — Deliver everything currently due. Returns how many were attempted.
- L241 `drain(max_passes: int=5)` (function) — Work through the backlog, stopping when it is empty or the budget is spent.
