---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:31'
updated: '2026-09-02T05:36:31'
---

# apps/api/src/blob_api/routers/agent_shell.py

Symbols in `apps/api/src/blob_api/routers/agent_shell.py`.

- L53 `agent_terminal_target(user_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Which agent a DM's terminal would open into, or why there isn't one.
- L76 `agent_shell_socket(websocket: WebSocket, plugin_id: IdParam)` (function)
- L127 `_pump(websocket: WebSocket, session: ShellSession)` (function) — Bytes both ways until either end stops, then stop the other.
- L160 `_from_agent(websocket: WebSocket, session: ShellSession)` (function) — PTY output to the browser, decoded as it arrives.
- L183 `_from_browser(websocket: WebSocket, session: ShellSession, touched: Any)` (function) — Keystrokes and window sizes from the console.
- L209 `_watch_idle(last_input: Any, started: float)` (function) — Close a session nobody is using, and one that has simply gone on too long.
- L228 `_send(websocket: WebSocket, payload: dict[str, Any])` (function)
