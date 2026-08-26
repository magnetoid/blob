---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:50:54'
updated: '2026-08-26T03:50:54'
---

# apps/api/src/blob_api/tools/agent_bridge.py

Symbols in `apps/api/src/blob_api/tools/agent_bridge.py`.

- L75 `Config` (class) — Everything from the environment, checked once so a typo fails at startup.
- L78 `__init__(self)` (method)
- L90 `socket_url(self)` (method) — The `/ws/agent` URL, with the scheme swapped for its WebSocket equivalent.
- L97 `_require(name: str)` (function)
- L104 `_sign(secret: str, timestamp: int, body: bytes)` (function) — Blob's scheme, which is Slack's: `v0=hex(hmac_sha256("v0:{ts}:{body}"))`.
- L114 `_sse_events(response: httpx.Response)` (function) — The JSON objects out of a `text/event-stream`.
- L157 `Bridge` (class)
- L158 `__init__(self, config: Config)` (method)
- L163 `serve_forever(self)` (method) — Connect, and keep connecting.
- L196 `_session(self)` (method) — One connection, from handshake to disconnect.
- L219 `_heartbeat(self, socket: Any)` (method)
- L224 `_read_loop(self, socket: Any)` (method)
- L258 `_say_hello(self, socket: Any)` (method) — Describe ourselves, if there is anything to say.
- L277 `_start_run(self, socket: Any, run_id: str, run_input: dict[str, Any])` (method)
- L285 `_run(self, socket: Any, run_id: str, run_input: dict[str, Any])` (method) — Forward one run to the local agent and relay what it says.
- L317 `_ask_agent(self, run_input: dict[str, Any])` (method) — POST the run to the local AG-UI server, signed the way Blob signs a delivery.
- L340 `_drain_runs(self)` (method) — Cancel what is still in flight, snapshotting first.
- L354 `main()` (function)
