---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/plugins/streams.py

Symbols in `apps/api/src/blob_api/plugins/streams.py`.

- L29 `Listener` (class)
- L40 `dials_in(self)` (method)
- L44 `transport(self)` (method)
- L48 `stream_run(listener: Listener, run_input: dict[str, Any], *, transport: httpx.AsyncBaseTransport | None=None, on_event: Callable[[Mapping[str, Any]], None] | None=None)` (function) — Call the agent and fold its stream. Returns (fold, messages to post, error).
- L138 `_rough_size(event: Mapping[str, Any])` (function) — About how big this event was, without paying to re-serialise it.
- L158 `_stream_over_socket(listener: Listener, run_input: dict[str, Any], *, on_event: Callable[[Mapping[str, Any]], None] | None=None)` (function) — The same run, down a connection the agent opened, from a process that is not this one.
