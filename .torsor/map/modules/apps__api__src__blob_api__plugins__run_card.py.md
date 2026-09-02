---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:26:06'
updated: '2026-09-02T04:26:06'
---

# apps/api/src/blob_api/plugins/run_card.py

Symbols in `apps/api/src/blob_api/plugins/run_card.py`.

- L34 `CardFold` (class) — Folds lifecycle events into the live card. `feed` returns whether it changed.
- L37 `__init__(self)` (method)
- L46 `feed(self, event: Mapping[str, Any])` (method)
- L83 `_step(self, event: Mapping[str, Any], *, running: bool)` (method)
- L107 `_tool_start(self, event: Mapping[str, Any])` (method)
- L119 `_tool_args(self, event: Mapping[str, Any])` (method)
- L131 `_tool_end(self, event: Mapping[str, Any], kind: str)` (method)
- L144 `_find_tool(self, event: Mapping[str, Any])` (method)
- L155 `_activity_line(self, event: Mapping[str, Any])` (method)
- L165 `snapshot(self)` (method) — The card as the wire and the row carry it. Snapshots, not deltas: a client
- L178 `has_content(self)` (method)
- L182 `_text(value: Any, cap: int)` (function)
