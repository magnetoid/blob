---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:20'
updated: '2026-09-02T05:49:20'
---

# apps/api/src/blob_api/tools/agent_bridge.py

Symbols in `apps/api/src/blob_api/tools/agent_bridge.py`.

- L79 `Config` (class) — Everything from the environment, checked once so a typo fails at startup.
- L82 `__init__(self)` (method)
- L94 `socket_url(self)` (method) — The `/ws/agent` URL, with the scheme swapped for its WebSocket equivalent.
- L108 `_require(name: str)` (function)
- L115 `_sign(secret: str, timestamp: int, body: bytes)` (function) — Blob's scheme, which is Slack's: `v0=hex(hmac_sha256("v0:{ts}:{body}"))`.
- L125 `_sse_events(response: httpx.Response)` (function) — The JSON objects out of a `text/event-stream`.
- L168 `Bridge` (class)
- L169 `__init__(self, config: Config)` (method)
- L174 `serve_forever(self)` (method) — Connect, and keep connecting.
- L207 `_session(self)` (method) — One connection, from handshake to disconnect.
- L230 `_heartbeat(self, socket: Any)` (method)
- L235 `_read_loop(self, socket: Any)` (method)
- L269 `_say_hello(self, socket: Any)` (method) — Describe ourselves, if there is anything to say.
- L288 `_start_run(self, socket: Any, run_id: str, run_input: dict[str, Any])` (method)
- L296 `_run(self, socket: Any, run_id: str, run_input: dict[str, Any])` (method) — Forward one run to the local agent and relay what it says.
- L328 `_ask_agent(self, run_input: dict[str, Any])` (method) — POST the run to the local AG-UI server, signed the way Blob signs a delivery.
- L351 `_drain_runs(self)` (method) — Cancel what is still in flight, snapshotting first.
- L365 `main()` (function)
