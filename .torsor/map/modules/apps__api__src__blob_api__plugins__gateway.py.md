---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T02:51:23'
updated: '2026-09-02T02:51:23'
---

# apps/api/src/blob_api/plugins/gateway.py

Symbols in `apps/api/src/blob_api/plugins/gateway.py`.

- L68 `conn_key(plugin_id: str)` (function)
- L72 `run_channel(plugin_id: str)` (function)
- L76 `event_channel(run_id: str)` (function)
- L80 `claim_key(run_id: str)` (function)
- L87 `is_online(plugin_id: str)` (function) — Whether any process currently holds this agent's connection.
- L92 `stream_events(plugin_id: str, run_input: dict[str, Any], *, timeout_sec: float)` (function) — Ask the agent to run, and yield the AG-UI events it sends back.
- L173 `live_connections()` (function) — How many agent sockets this process is holding. The socket-leak test's probe.
- L178 `AgentConnection` (class) — One live agent socket, and the pump that feeds it runs from other processes.
- L191 `__init__(self, plugin_id: str, send: Any)` (method)
- L196 `__aenter__(self)` (method)
- L203 `__aexit__(self, *_exc: object)` (method)
- L222 `_spawn(self, coro: Any)` (method)
- L227 `_refresh_presence(self)` (method)
- L233 `_pump_runs(self)` (method) — Take run requests off Redis and write them to the agent.
- L292 `owns_run(plugin_id: str, run_id: str)` (function) — Whether this agent is the one that was asked to do this run.
- L315 `relay_event(run_id: str, event: dict[str, Any])` (function) — Put one AG-UI event from the agent back on the wire to whoever asked for the run.
- L320 `relay_end(run_id: str)` (function) — Tell the caller the agent considers this run over, so it stops waiting on a clock.
- L325 `run_timeout_sec()` (function) — The ceiling on a socket run.
