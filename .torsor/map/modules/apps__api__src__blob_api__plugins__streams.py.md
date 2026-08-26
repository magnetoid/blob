---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/plugins/streams.py

Symbols in `apps/api/src/blob_api/plugins/streams.py`.

- L32 `Listener` (class)
- L50 `dials_in(self)` (method)
- L54 `runs_here(self)` (method)
- L58 `transport(self)` (method)
- L66 `stream_run(listener: Listener, run_input: dict[str, Any], *, transport: httpx.AsyncBaseTransport | None=None)` (function) — Call the agent and fold its stream. Returns (fold, messages to post, error).
- L143 `_rough_size(event: Mapping[str, Any])` (function) — About how big this event was, without paying to re-serialise it.
- L163 `_stream_over_socket(listener: Listener, run_input: dict[str, Any])` (function) — The same run, down a connection the agent opened, from a process that is not this one.
- L219 `_stream_builtin(listener: Listener, run_input: dict[str, Any])` (function) — The same run, against a model, without leaving the process.
