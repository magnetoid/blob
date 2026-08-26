"""A terminal inside a hosted agent's container.

An agent is a program somebody has to set up. Not all of that setup is declarative: a
device-code login prints a URL and waits, a broken virtualenv needs looking at, a prompt
file needs editing, and none of those are a form. On a laptop that work happens over a
shell, and an agent Blob deployed had no equivalent — the console could redeploy it and
read its logs, which is the difference between an operator who can fix a thing and one
who can only turn it off and on again.

**ADR 0010 said Blob must never hold the Docker socket.** That decision was overruled
deliberately, and its reasoning is honoured rather than discarded. The host this was
written for runs about thirty domains; a compromise of the chat app must still not be a
compromise of the box. So Blob does not get the socket. It gets an SSH key whose only
power is what the far end's forced command allows:

    command="/usr/local/bin/blob-agent-exec",no-port-forwarding,no-agent-forwarding,
    no-X11-forwarding,no-user-rc ssh-ed25519 AAAA…

sshd runs that wrapper no matter what this client asks for, so the request below is not a
command — it is an *argument*, and the only argument accepted is a deployment id. The
wrapper refuses anything that is not one, refuses Blob's own deployment, and execs a
shell in that container and nothing else. The blast radius of this credential is one
`docker exec` into one agent. See `docs/agent-terminal.md` for the host half.

The host key is **required**. Without it this is an authenticated shell session handed to
whoever answers on that address, and an escape hatch labelled "skip verification" is the
thing that ends up switched on in production. A missing host key leaves the feature off,
which is a state the console explains.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from types import TracebackType
from typing import Any, Protocol

import asyncssh

from ..config import settings
from ..lib.errors import AppError, bad_request

log = logging.getLogger("blob.agents.shell")

#: What the far end is told the terminal is. `xterm-256color` is what every shell, editor
#: and progress spinner already knows, and it is what xterm.js renders.
TERM_TYPE = "xterm-256color"

#: Read size. Large enough that a program dumping a file does not turn into thousands of
#: frames, small enough that a prompt appears as it is written rather than in a burst.
READ_BYTES = 8192

#: Bounds on what a client may ask the far end to believe the window is. A terminal is
#: sized by the browser, and a browser is not a trusted source of small integers.
MIN_COLS, MAX_COLS = 20, 500
MIN_ROWS, MAX_ROWS = 5, 200


class ShellSession(Protocol):
    """One open terminal. Bytes in, bytes out, and a size that can change."""

    async def read(self) -> bytes: ...

    async def write(self, data: bytes) -> None: ...

    def resize(self, cols: int, rows: int) -> None: ...

    @property
    def exit_status(self) -> int | None: ...

    async def close(self) -> None: ...


class AgentShell(Protocol):
    async def open(self, deployment_id: str, *, cols: int, rows: int) -> ShellSession: ...


def clamp_size(cols: object, rows: object) -> tuple[int, int]:
    """A window size that is safe to pass on, whatever arrived.

    Not validation with a refusal: a resize is a side effect of the browser window
    moving, and dropping a session because a tab was minimised to zero columns would be
    absurd. Out-of-range is pinned to the range.
    """
    try:
        wide = int(cols)  # type: ignore[call-overload]
        high = int(rows)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return 80, 24
    return (
        max(MIN_COLS, min(MAX_COLS, wide)),
        max(MIN_ROWS, min(MAX_ROWS, high)),
    )


class SshShellSession:
    """A PTY on the far side of one SSH connection.

    The connection is per-session on purpose. Multiplexing several terminals down one
    connection would mean one dropped TCP connection closing every operator's session at
    once, and would make "who is holding what" a bookkeeping problem this does not need
    to have.
    """

    def __init__(self, conn: asyncssh.SSHClientConnection, process: Any) -> None:
        self._conn = conn
        self._process = process

    async def read(self) -> bytes:
        """The next output, or empty at end of stream."""
        data = await self._process.stdout.read(READ_BYTES)
        return bytes(data) if data else b""

    async def write(self, data: bytes) -> None:
        self._process.stdin.write(data)

    def resize(self, cols: int, rows: int) -> None:
        # Width then height — asyncssh takes columns first, and a transposed call makes a
        # terminal that wraps every line at 24 characters, which reads as a broken shell
        # rather than as a wrong number.
        with contextlib.suppress(Exception):
            self._process.change_terminal_size(cols, rows)

    @property
    def exit_status(self) -> int | None:
        status = self._process.exit_status
        return int(status) if isinstance(status, int) else None

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            self._process.terminate()
        self._conn.close()
        with contextlib.suppress(Exception):
            await self._conn.wait_closed()


class SshAgentShell:
    """Opens a terminal by asking the host's forced command for one."""

    async def open(self, deployment_id: str, *, cols: int, rows: int) -> ShellSession:
        try:
            conn = await asyncio.wait_for(
                asyncssh.connect(
                    settings.AGENT_SHELL_HOST or "",
                    port=settings.AGENT_SHELL_PORT,
                    username=settings.AGENT_SHELL_USER,
                    client_keys=[_client_key()],
                    known_hosts=_known_hosts(),
                    # Never read the ambient ssh config. What this connects to must come
                    # from Blob's own settings, not from a file that happens to be in the
                    # image or mounted into it.
                    config=None,
                ),
                timeout=settings.AGENT_SHELL_CONNECT_TIMEOUT_SEC,
            )
        except asyncssh.HostKeyNotVerifiable as exc:
            # Loud and separate from every other failure: this is the one that means
            # something is answering on that address that was not there before.
            log.error("agent shell host key did not verify: %s", exc)
            raise AppError(
                502,
                "shell_host_key",
                "The terminal host is not the one Blob was told to expect.",
            ) from exc
        except (TimeoutError, OSError, asyncssh.Error) as exc:
            log.warning("agent shell could not connect: %s", exc)
            raise AppError(
                502, "shell_unreachable", "Could not reach the host that runs the agents."
            ) from exc

        try:
            # The deployment id is the *argument* to the host's forced command, not a
            # command being run. sshd hands it over as SSH_ORIGINAL_COMMAND and the
            # wrapper decides whether it names an agent it is willing to open.
            process = await conn.create_process(
                deployment_id,
                term_type=TERM_TYPE,
                term_size=(cols, rows),
                encoding=None,
            )
        except asyncssh.Error as exc:
            conn.close()
            log.warning("agent shell refused for %s: %s", deployment_id, exc)
            raise AppError(
                502, "shell_refused", "The host would not open a terminal in that agent."
            ) from exc

        return SshShellSession(conn, process)


def _client_key() -> asyncssh.SSHKey:
    """Blob's half of the credential, from configuration rather than from disk.

    Accepted inline because that is how a container is configured. A private key pasted
    into a single environment variable arrives with its newlines escaped as often as not,
    depending on which shell, dashboard or compose file it passed through, so both forms
    are read rather than only the correct one.
    """
    raw = (settings.AGENT_SHELL_KEY or "").strip()
    if not raw:
        raise bad_request(
            "The terminal is not set up: no key was configured.", code="shell_disabled"
        )
    if "\\n" in raw and "\n" not in raw:
        raw = raw.replace("\\n", "\n")
    try:
        return asyncssh.import_private_key(raw + "\n")
    except asyncssh.KeyImportError as exc:
        # Configuration is wrong, not the request. Said once, at the point of use, rather
        # than as a stack trace in a log nobody is reading.
        raise AppError(
            500, "shell_bad_key", "The terminal key is not a usable private key."
        ) from exc


def _known_hosts() -> Any:
    """What Blob will accept as the host, in the format asyncssh reads.

    Operators copy this out of `ssh-keyscan`, which prints a full known_hosts line, or out
    of a `.pub` file, which prints only the type and the key. Both are common enough that
    guessing wrong means the feature does not work and the message says "host key did not
    verify", which sends the reader looking for an attacker rather than a missing field.
    """
    entry = (settings.AGENT_SHELL_HOST_KEY or "").strip()
    if not entry:
        raise bad_request(
            "The terminal is not set up: no host key was configured.", code="shell_disabled"
        )

    host = settings.AGENT_SHELL_HOST or ""
    port = settings.AGENT_SHELL_PORT
    # A non-default port is written `[host]:port` in known_hosts, and a line written for
    # the default port does not match a connection to another one.
    pattern = host if port == 22 else f"[{host}]:{port}"

    if len(entry.split()) == 2:
        entry = f"{pattern} {entry}"

    try:
        return asyncssh.import_known_hosts(entry + "\n")
    except (ValueError, asyncssh.KeyImportError) as exc:
        raise AppError(
            500, "shell_bad_host_key", "The configured terminal host key is not readable."
        ) from exc


class ShellHandle:
    """A session with a guaranteed close, so a dropped socket cannot leak a connection."""

    def __init__(self, shell: AgentShell, deployment_id: str, cols: int, rows: int) -> None:
        self._shell = shell
        self._deployment_id = deployment_id
        self._size = (cols, rows)
        self._session: ShellSession | None = None

    async def __aenter__(self) -> ShellSession:
        cols, rows = self._size
        self._session = await self._shell.open(self._deployment_id, cols=cols, rows=rows)
        return self._session

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._session is not None:
            await self._session.close()


def current_shell() -> AgentShell:
    """The configured terminal, or a refusal that says which half is missing.

    Off is a normal state. Blob hosts agents perfectly well without it; only the "and let
    me get inside one" part needs a host willing to be asked.
    """
    if not settings.agent_shell_enabled:
        raise bad_request(
            "The agent terminal is not set up on this server. It needs a host that will "
            "open a shell in an agent's container — see docs/agent-terminal.md.",
            code="shell_disabled",
        )
    return SshAgentShell()


__all__ = [
    "MAX_COLS",
    "MAX_ROWS",
    "MIN_COLS",
    "MIN_ROWS",
    "READ_BYTES",
    "TERM_TYPE",
    "AgentShell",
    "ShellHandle",
    "ShellSession",
    "SshAgentShell",
    "SshShellSession",
    "clamp_size",
    "current_shell",
]
