---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:26:06'
updated: '2026-09-02T04:26:06'
---

# apps/api/src/blob_api/services/recurrence.py

Symbols in `apps/api/src/blob_api/services/recurrence.py`.

- L27 `_zone(name: str)` (function) — The author's zone, or UTC. A zone that has gone away must not stop the sweep.
- L35 `next_occurrence(previous: datetime, repeat: str, timezone: str)` (function) — The moment after `previous` that `repeat` next names, or None if it names none.
- L73 `describe(repeat: str | None)` (function) — How a schedule reads in a list. Plain words, because it sits beside a message.
