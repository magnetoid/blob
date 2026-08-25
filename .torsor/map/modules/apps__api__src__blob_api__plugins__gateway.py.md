---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
---

# apps/api/src/blob_api/plugins/gateway.py

Symbols in `apps/api/src/blob_api/plugins/gateway.py`.

- L68 `conn_key(plugin_id: str)` (function)
- L72 `run_channel(plugin_id: str)` (function)
- L76 `event_channel(run_id: str)` (function)
- L80 `claim_key(run_id: str)` (function)
- L87 `is_online(plugin_id: str)` (function) — Whether any process currently holds this agent's connection.
- L92 `stream_events(plugin_id: str, run_input: dict[str, Any], *, timeout_sec: float)` (function) — Ask the agent to run, and yield the AG-UI events it sends back.
- L154 `live_connections()` (function) — How many agent sockets this process is currently holding.
- L159 `AgentConnection` (class) — One live agent socket, and the pump that feeds it runs from other processes.
- L172 `__init__(self, plugin_id: str, send: Any)` (method)
- L177 `__aenter__(self)` (method)
- L184 `__aexit__(self, *_exc: object)` (method)
- L203 `_spawn(self, coro: Any)` (method)
- L208 `_refresh_presence(self)` (method)
- L214 `_pump_runs(self)` (method) — Take run requests off Redis and write them to the agent.
- L258 `relay_event(run_id: str, event: dict[str, Any])` (function) — Put one AG-UI event from the agent back on the wire to whoever asked for the run.
- L263 `relay_end(run_id: str)` (function) — Tell the caller the agent considers this run over, so it stops waiting on a clock.
- L268 `run_timeout_sec()` (function) — The ceiling on a socket run.
