---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:41'
updated: '2026-08-27T02:15:41'
---

# apps/api/src/blob_api/routers/agent_shell.py

Symbols in `apps/api/src/blob_api/routers/agent_shell.py`.

- L52 `agent_shell_socket(websocket: WebSocket, plugin_id: str)` (function)
- L103 `_pump(websocket: WebSocket, session: ShellSession)` (function) — Bytes both ways until either end stops, then stop the other.
- L136 `_from_agent(websocket: WebSocket, session: ShellSession)` (function) — PTY output to the browser, decoded as it arrives.
- L159 `_from_browser(websocket: WebSocket, session: ShellSession, touched: Any)` (function) — Keystrokes and window sizes from the console.
- L185 `_watch_idle(last_input: Any, started: float)` (function) — Close a session nobody is using, and one that has simply gone on too long.
- L204 `_send(websocket: WebSocket, payload: dict[str, Any])` (function)
