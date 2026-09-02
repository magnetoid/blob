---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:50:24'
updated: '2026-09-02T04:50:24'
---

# apps/api/src/blob_api/plugins/shell.py

Symbols in `apps/api/src/blob_api/plugins/shell.py`.

- L60 `ShellSession` (class) — One open terminal. Bytes in, bytes out, and a size that can change.
- L63 `read(self)` (method)
- L65 `write(self, data: bytes)` (method)
- L67 `resize(self, cols: int, rows: int)` (method)
- L70 `exit_status(self)` (method)
- L72 `close(self)` (method)
- L75 `AgentShell` (class)
- L76 `open(self, deployment_id: str, *, cols: int, rows: int)` (method)
- L79 `clamp_size(cols: object, rows: object)` (function) — A window size that is safe to pass on, whatever arrived.
- L97 `SshShellSession` (class) — A PTY on the far side of one SSH connection.
- L106 `__init__(self, conn: asyncssh.SSHClientConnection, process: Any)` (method)
- L110 `read(self)` (method) — The next output, or empty at end of stream.
- L115 `write(self, data: bytes)` (method)
- L118 `resize(self, cols: int, rows: int)` (method)
- L126 `exit_status(self)` (method)
- L130 `close(self)` (method)
- L138 `SshAgentShell` (class) — Opens a terminal by asking the host's forced command for one.
- L141 `open(self, deployment_id: str, *, cols: int, rows: int)` (method)
- L192 `_client_key()` (function) — Blob's half of the credential, from configuration rather than from disk.
- L217 `_known_hosts()` (function) — What Blob will accept as the host, in the format asyncssh reads.
- L248 `ShellHandle` (class) — A session with a guaranteed close, so a dropped socket cannot leak a connection.
- L251 `__init__(self, shell: AgentShell, deployment_id: str, cols: int, rows: int)` (method)
- L257 `__aenter__(self)` (method)
- L262 `__aexit__(self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None)` (method)
- L272 `current_shell()` (function) — The configured terminal, or a refusal that says which half is missing.
