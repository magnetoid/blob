---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/routers/agent_shell.py

Symbols in `apps/api/src/blob_api/routers/agent_shell.py`.

- L54 `agent_terminal_target(user_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Which agent a DM's terminal would open into, or why there isn't one.
- L77 `agent_shell_socket(websocket: WebSocket, plugin_id: IdParam)` (function)
- L128 `_pump(websocket: WebSocket, session: ShellSession)` (function) — Bytes both ways until either end stops, then stop the other.
- L161 `_from_agent(websocket: WebSocket, session: ShellSession)` (function) — PTY output to the browser, decoded as it arrives.
- L184 `_from_browser(websocket: WebSocket, session: ShellSession, touched: Any)` (function) — Keystrokes and window sizes from the console.
- L210 `_watch_idle(last_input: Any, started: float)` (function) — Close a session nobody is using, and one that has simply gone on too long.
- L229 `_send(websocket: WebSocket, payload: dict[str, Any])` (function)
