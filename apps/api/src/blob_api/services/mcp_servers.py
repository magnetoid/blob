"""MCP servers an admin connected, and the tools agents may use from them (ADR 0027).

Not `services/mcp.py`, which is Blob *being* an MCP server. Here Blob is the client: an
admin connects a server, Blob lists its tools (`plugins/mcp_client.py`), and the agents the
admin grants it are offered those tools in their runs — as client-executed AG-UI tools,
beside Blob's own, run by Blob with the server's credential when an agent calls one.

What this module keeps:

- **The server, checked before it is kept.** A name, a public https address (or a private
  one where the operator and the workspace both allow it, as for apps), an optional secret
  header. It is listed before it is stored, so a server that cannot answer is never added.
- **Each tool's policy, the admin's.** `off`, or when a call waits for the person who asked
  — `ask`, `auto_in_dm`, `auto_everywhere`, the values `plugins.write_approval` uses. A
  tool the server calls read-only starts at `auto_everywhere`; anything else at `ask`. The
  server's word sets the default and no more: the admin sees every tool and its policy.
- **Who may use it.** An agent (an app that answers over AG-UI or a socket) the admin
  granted the server to — and so everyone who may command that agent.
- **What one run is offered.** `tools_for_agent`, read once as a run begins: the granted,
  switched-on servers' tools that are not off, in a stable order, named `<slug>__<tool>`
  so they cannot collide with Blob's tools or each other's.

The secret header lives in `mcp_server_secrets` and is read only where a request is made;
no view here returns it.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib import net
from ..lib.errors import AppError, bad_request, conflict, not_found, unique_violation
from ..lib.ids import new_id
from ..plugins import mcp_client
from . import policies

#: The admin's choices for one tool, in the order the console offers them.
POLICIES = ("off", "ask", "auto_in_dm", "auto_everywhere")

#: Servers one workspace may connect.
MAX_SERVERS = 20
#: Tools from servers one run is offered, and the bytes their schemas may add to its
#: input. A model choosing among hundreds of tools chooses badly; past these, the rest wait.
MAX_OFFERED = 64
MAX_OFFERED_SCHEMA_BYTES = 256 * 1024
NAME_MAX = 60
URL_MAX = 2_000
SECRET_MAX = 8_192
SLUG_MAX = 24
#: An agent-facing name is a function name to every model provider: these characters, at
#: most this long.
OFFERED_NAME_MAX = 64
_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")
_TCHAR = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
#: Headers Blob sets on every request itself, which a secret header may not replace.
_RESERVED_HEADERS = frozenset(
    {
        "accept",
        "content-type",
        "content-length",
        "host",
        "user-agent",
        "traceparent",
        "tracestate",
        "mcp-protocol-version",
        "mcp-method",
        "mcp-name",
        "mcp-session-id",
    }
)

AuthKind = Literal["none", "bearer", "header"]


@dataclass(frozen=True, slots=True)
class Auth:
    """How a server is called: no credential, a bearer token, or one named header."""

    kind: AuthKind
    #: The token, for `bearer`; the header's value, for `header`.
    value: str | None = None
    #: The header's name, for `header`.
    header: str | None = None


@dataclass(frozen=True, slots=True)
class OutsideTool:
    """One tool from a server, as one run is offered it."""

    #: What the agent calls it: `<slug>__<tool>`, made safe for any model provider.
    offered_name: str
    server_id: str
    server_name: str
    slug: str
    #: The server's own name for it, which the call carries.
    name: str
    title: str | None
    description: str
    input_schema: dict[str, Any]
    policy: str
    endpoint: mcp_client.Endpoint

    def runs_without_asking(self, *, in_their_dm: bool) -> bool:
        """Whether a call runs at once. `in_their_dm` is the agent's own DM with the
        person — the one room where nobody else's words can have steered it."""
        return self.policy == "auto_everywhere" or (self.policy == "auto_in_dm" and in_their_dm)

    def as_offered(self) -> dict[str, Any]:
        """As `RunAgentInput.tools` carries it. The agent is told whose tool it is and
        whether a call waits for the person, so it can say so instead of surprising them;
        the schema loses its `x-mcp-header` marks, which are transport detail."""
        waits = {
            "ask": "Each call waits for the person you are working for to approve it.",
            "auto_in_dm": (
                "In your own DM with the person you are working for it runs at once; "
                "anywhere else each call waits for their approval."
            ),
        }.get(self.policy, "")
        said = self.description or self.title or self.name
        note = f"(A tool on {self.server_name}, outside Blob. {waits})".replace(" )", ")")
        return {
            "name": self.offered_name,
            "description": f"{said}\n\n{note}",
            "parameters": mcp_client.strip_marks(self.input_schema),
        }


def default_policy(tool: mcp_client.ToolDef) -> str:
    """A tool's policy before an admin says otherwise: runs at once if the server says it
    only reads, asks the person otherwise."""
    return "auto_everywhere" if tool.read_only else "ask"


# ─── checking what an admin typed ────────────────────────────────────────────────────


def clean_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise bad_request("Give the server a name.", code="invalid_input")
    if len(name) > NAME_MAX:
        raise bad_request(f"A name is at most {NAME_MAX} characters.", code="invalid_input")
    return name


def secret_of(auth: Auth) -> tuple[str, str] | None:
    """The header a server is called with, checked: none, `Authorization: Bearer …`, or a
    named header Blob does not set itself."""
    if auth.kind == "none":
        return None
    value = (auth.value or "").strip()
    if not value:
        raise bad_request("Paste the token the server gave you.", code="invalid_input")
    if len(value) > SECRET_MAX or not all(0x20 <= ord(char) <= 0x7E for char in value):
        # A header carries visible ASCII and spaces. A token pasted with a stray
        # non-breaking space or a curly quote would otherwise fail inside the HTTP library,
        # as an error nobody had written a message for.
        raise bad_request(
            "That token has characters a header cannot carry — paste it again, without "
            "line breaks or curly quotes.",
            code="invalid_input",
        )
    if auth.kind == "bearer":
        token = value[7:].strip() if value.lower().startswith("bearer ") else value
        return ("Authorization", f"Bearer {token}")
    header = (auth.header or "").strip()
    if not _TCHAR.match(header):
        raise bad_request("That is not a header name.", code="invalid_input")
    if header.lower() in _RESERVED_HEADERS or header.lower().startswith("mcp-param-"):
        raise bad_request(f"Blob sets {header} itself; use another header.", code="invalid_input")
    return (header, value)


async def private_ok(session: AsyncSession, workspace_id: str) -> bool:
    """Whether this workspace may reach a private address — the same switch apps use, the
    operator's and the workspace's both."""
    return (await policies.effective_for(session, workspace_id)).may_use_private_endpoints


async def check_url(raw: str, *, allow_private: bool) -> str:
    url = raw.strip()
    if not url or len(url) > URL_MAX:
        raise bad_request("Give the server's MCP address.", code="bad_mcp_url")
    if allow_private:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise bad_request("That is not a valid URL.", code="bad_mcp_url")
        return url
    reason = await net.check_outbound_url(url, require_https=True)
    if reason is not None:
        raise bad_request(reason, code="bad_mcp_url")
    return url


def slug_for(name: str, taken: set[str]) -> str:
    """A prefix for the server's tools, from its name: lowercase letters, digits and
    hyphens, starting with a letter, unique in the workspace. Never an underscore, so the
    `__` between it and a tool's name can only be read one way."""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:SLUG_MAX].strip("-")
    if not base or not base[0].isalpha():
        base = f"mcp-{base}".strip("-")[:SLUG_MAX].strip("-")
    candidate, number = base, 2
    while candidate in taken:
        suffix = f"-{number}"
        candidate = base[: SLUG_MAX - len(suffix)].strip("-") + suffix
        number += 1
    return candidate


def offered_name(slug: str, tool: str, taken: set[str]) -> str:
    """`<slug>__<tool>`, in the characters every model provider accepts, unique in the run."""
    name = f"{slug}__{_UNSAFE.sub('_', tool)}"
    if len(name) <= OFFERED_NAME_MAX and name not in taken:
        return name
    digest = hashlib.sha256(f"{slug}/{tool}".encode()).hexdigest()[:6]
    return f"{name[: OFFERED_NAME_MAX - 7]}_{digest}"


def _raise_unreachable(error: mcp_client.McpError) -> AppError:
    return bad_request(error.message, code="mcp_unreachable")


# ─── connecting, refreshing, changing ────────────────────────────────────────────────


@dataclass(slots=True)
class Prepared:
    """A server checked and listed, ready to be stored."""

    name: str
    url: str
    secret: tuple[str, str] | None
    listing: mcp_client.Listing


async def prepare(
    workspace_id: str, *, name: str, url: str, auth: Auth, server_id: str | None = None
) -> Prepared:
    """Check what the admin typed and list the server's tools — before anything is kept,
    and outside any transaction, since a server may take seconds to answer."""
    cleaned = clean_name(name)
    secret = secret_of(auth)
    async with session_scope() as session:
        allow_private = await private_ok(session, workspace_id)
        checked = await check_url(url, allow_private=allow_private)
        taken = (
            await session.execute(
                text(
                    """
                    SELECT id FROM mcp_servers
                     WHERE workspace_id = :ws AND lower(name) = lower(:name)
                       AND (CAST(:id AS uuid) IS NULL OR id <> CAST(:id AS uuid))
                    """
                ),
                {"ws": workspace_id, "name": cleaned, "id": server_id},
            )
        ).first()
        if taken is not None:
            raise conflict(f"There is already a server called {cleaned}.", "mcp_server_exists")
        if server_id is None:
            count = (
                await session.execute(
                    text("SELECT count(*) FROM mcp_servers WHERE workspace_id = :ws"),
                    {"ws": workspace_id},
                )
            ).scalar_one()
            if int(count) >= MAX_SERVERS:
                raise bad_request(
                    f"A workspace can connect at most {MAX_SERVERS} servers.",
                    code="mcp_server_limit",
                )
    endpoint = mcp_client.Endpoint(
        server_id=server_id or "new", url=checked, secret=secret, private_ok=allow_private
    )
    try:
        listing = await mcp_client.list_tools(endpoint)
    except mcp_client.McpError as error:
        raise _raise_unreachable(error) from error
    return Prepared(name=cleaned, url=checked, secret=secret, listing=listing)


async def insert(session: AsyncSession, workspace_id: str, prepared: Prepared, *, by: str) -> str:
    """Keep a server that `prepare` checked: its row, its secret, its tools."""
    taken = {
        str(row.slug)
        for row in (
            await session.execute(
                text("SELECT slug FROM mcp_servers WHERE workspace_id = :ws"), {"ws": workspace_id}
            )
        ).fetchall()
    }
    server_id = new_id()
    try:
        await session.execute(
            text(
                """
                INSERT INTO mcp_servers (id, workspace_id, name, slug, url, created_by)
                VALUES (:id, :ws, :name, :slug, :url, :by)
                """
            ),
            {
                "id": server_id,
                "ws": workspace_id,
                "name": prepared.name,
                "slug": slug_for(prepared.name, taken),
                "url": prepared.url,
                "by": by,
            },
        )
    except Exception as exc:
        if unique_violation(exc):
            raise conflict(
                f"There is already a server called {prepared.name}.", "mcp_server_exists"
            ) from exc
        raise
    await _store_secret(session, server_id, prepared.secret)
    await store_listing(session, server_id, prepared.listing)
    return server_id


async def _store_secret(
    session: AsyncSession, server_id: str, secret: tuple[str, str] | None
) -> None:
    if secret is None:
        await session.execute(
            text("DELETE FROM mcp_server_secrets WHERE server_id = :id"), {"id": server_id}
        )
        return
    await session.execute(
        text(
            """
            INSERT INTO mcp_server_secrets (server_id, header_name, header_value)
            VALUES (:id, :name, :value)
            ON CONFLICT (server_id) DO UPDATE
               SET header_name = EXCLUDED.header_name,
                   header_value = EXCLUDED.header_value,
                   updated_at = now()
            """
        ),
        {"id": server_id, "name": secret[0], "value": secret[1]},
    )


async def store_listing(session: AsyncSession, server_id: str, listing: mcp_client.Listing) -> None:
    """What the server listed, kept: a tool it still has keeps the policy an admin gave it,
    a new one starts at its default, and one it no longer lists is gone."""
    names = [tool.name for tool in listing.tools]
    await session.execute(
        text("DELETE FROM mcp_server_tools WHERE server_id = :id AND NOT (name = ANY(:names))"),
        {"id": server_id, "names": names},
    )
    if listing.tools:
        await session.execute(
            text(
                """
                INSERT INTO mcp_server_tools
                       (server_id, name, position, title, description, input_schema,
                        read_only, policy)
                VALUES (:id, :name, :position, :title, :description,
                        CAST(:schema AS jsonb), :read_only, :policy)
                ON CONFLICT (server_id, name) DO UPDATE
                   SET position = EXCLUDED.position,
                       title = EXCLUDED.title,
                       description = EXCLUDED.description,
                       input_schema = EXCLUDED.input_schema,
                       read_only = EXCLUDED.read_only
                """
            ),
            [
                {
                    "id": server_id,
                    "name": tool.name,
                    "position": position,
                    "title": tool.title,
                    "description": tool.description,
                    "schema": json.dumps(tool.input_schema),
                    "read_only": tool.read_only,
                    "policy": default_policy(tool),
                }
                for position, tool in enumerate(listing.tools)
            ],
        )
    await session.execute(
        text(
            """
            UPDATE mcp_servers
               SET era = :era, protocol_version = :version,
                   server_name = :server_name, server_version = :server_version,
                   checked_at = now(), last_error = NULL, last_error_at = NULL,
                   updated_at = now()
             WHERE id = :id
            """
        ),
        {
            "id": server_id,
            "era": listing.era,
            "version": listing.protocol_version,
            "server_name": listing.server_name,
            "server_version": listing.server_version,
        },
    )


async def _row(session: AsyncSession, workspace_id: str, server_id: str) -> Any:
    row = (
        await session.execute(
            text(
                """
                SELECT s.*, sec.header_name, sec.header_value
                  FROM mcp_servers s
                  LEFT JOIN mcp_server_secrets sec ON sec.server_id = s.id
                 WHERE s.id = :id AND s.workspace_id = :ws
                """
            ),
            {"id": server_id, "ws": workspace_id},
        )
    ).first()
    if row is None:
        raise not_found("There is no such server.")
    return row


async def refresh(workspace_id: str, server_id: str) -> None:
    """List the server's tools again. A server that cannot answer keeps the tools it had,
    and says why on its row."""
    async with session_scope() as session:
        row = await _row(session, workspace_id, server_id)
        allow_private = await private_ok(session, workspace_id)
    endpoint = _endpoint(row, allow_private=allow_private, probe=True)
    try:
        listing = await mcp_client.list_tools(endpoint)
    except mcp_client.McpError as error:
        await note_failure(server_id, error.message)
        raise _raise_unreachable(error) from error
    async with transaction() as (session, _after):
        await store_listing(session, server_id, listing)


async def change(
    workspace_id: str,
    server_id: str,
    *,
    name: str | None,
    url: str | None,
    auth: Auth | None,
    enabled: bool | None,
) -> Prepared | None:
    """Check a change before it is kept. A new address or credential is listed first, as a
    new server is; a new name or the switch alone needs no answer from the server."""
    async with session_scope() as session:
        row = await _row(session, workspace_id, server_id)
    if url is None and auth is None:
        if name is not None:
            clean_name(name)
        return None
    current_secret = (row.header_name, row.header_value) if row.header_name else None
    if auth is None:
        auth = (
            Auth("header", value=current_secret[1], header=current_secret[0])
            if current_secret is not None
            else Auth("none")
        )
    return await prepare(
        workspace_id,
        name=name if name is not None else row.name,
        url=url if url is not None else row.url,
        auth=auth,
        server_id=server_id,
    )


async def apply_change(
    session: AsyncSession,
    workspace_id: str,
    server_id: str,
    *,
    name: str | None,
    enabled: bool | None,
    prepared: Prepared | None,
) -> None:
    await _row(session, workspace_id, server_id)
    try:
        await session.execute(
            text(
                """
                UPDATE mcp_servers
                   SET name = COALESCE(:name, name),
                       url = COALESCE(:url, url),
                       enabled = COALESCE(:enabled, enabled),
                       updated_at = now()
                 WHERE id = :id
                """
            ),
            {
                "id": server_id,
                "name": clean_name(name) if name is not None else None,
                "url": prepared.url if prepared is not None else None,
                "enabled": enabled,
            },
        )
    except Exception as exc:
        if unique_violation(exc):
            raise conflict("There is already a server by that name.", "mcp_server_exists") from exc
        raise
    if prepared is not None:
        await _store_secret(session, server_id, prepared.secret)
        await store_listing(session, server_id, prepared.listing)


async def remove(session: AsyncSession, workspace_id: str, server_id: str) -> str:
    """Disconnect a server. Its tools leave every agent's next run at once. Answers its name."""
    row = await _row(session, workspace_id, server_id)
    await session.execute(text("DELETE FROM mcp_servers WHERE id = :id"), {"id": server_id})
    return str(row.name)


async def set_policy(
    session: AsyncSession, workspace_id: str, server_id: str, tool: str, policy: str
) -> None:
    if policy not in POLICIES:
        raise bad_request("That is not a policy.", code="invalid_input")
    await _row(session, workspace_id, server_id)
    done = await session.execute(
        text("UPDATE mcp_server_tools SET policy = :policy WHERE server_id = :id AND name = :name"),
        {"id": server_id, "name": tool, "policy": policy},
    )
    if not getattr(done, "rowcount", 0):
        raise not_found("That server has no such tool.")


async def grant(
    session: AsyncSession, workspace_id: str, plugin_id: str, server_id: str, *, by: str
) -> None:
    """Let an agent use a server's tools. Only an agent: an app that answers over AG-UI or
    holds a socket, since nothing else is ever offered a tool."""
    await _row(session, workspace_id, server_id)
    agent = (
        await session.execute(
            text(
                """
                SELECT agui_url, runtime FROM plugins
                 WHERE id = :id AND workspace_id = :ws
                """
            ),
            {"id": plugin_id, "ws": workspace_id},
        )
    ).first()
    if agent is None:
        raise not_found("There is no such app.")
    if agent.agui_url is None and agent.runtime != "socket":
        raise bad_request(
            "Only an agent that answers over AG-UI can use tools.", code="not_an_agent"
        )
    await session.execute(
        text(
            """
            INSERT INTO agent_mcp_servers (plugin_id, server_id, workspace_id, created_by)
            VALUES (:plugin, :server, :ws, :by)
            ON CONFLICT DO NOTHING
            """
        ),
        {"plugin": plugin_id, "server": server_id, "ws": workspace_id, "by": by},
    )


async def revoke(session: AsyncSession, workspace_id: str, plugin_id: str, server_id: str) -> None:
    await _row(session, workspace_id, server_id)
    await session.execute(
        text(
            """
            DELETE FROM agent_mcp_servers
             WHERE plugin_id = :plugin AND server_id = :server AND workspace_id = :ws
            """
        ),
        {"plugin": plugin_id, "server": server_id, "ws": workspace_id},
    )


# ─── what the console is shown ───────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ToolView:
    name: str
    title: str | None
    description: str
    read_only: bool
    policy: str


@dataclass(frozen=True, slots=True)
class ServerView:
    id: str
    name: str
    slug: str
    url: str
    enabled: bool
    auth: AuthKind
    #: The header's name, for `header`; never its value, for any kind.
    auth_header: str | None
    era: str | None
    protocol_version: str | None
    server_name: str | None
    server_version: str | None
    checked_at: Any
    last_error: str | None
    last_error_at: Any
    created_at: Any
    tools: list[ToolView]
    agent_ids: list[str]


def _auth_of(header_name: str | None, header_value: str | None) -> tuple[AuthKind, str | None]:
    if not header_name:
        return "none", None
    if header_name.lower() == "authorization" and (header_value or "").startswith("Bearer "):
        return "bearer", None
    return "header", header_name


async def views(
    session: AsyncSession, workspace_id: str, server_id: str | None = None
) -> list[ServerView]:
    """Every server in the workspace (or one), with its tools and the agents granted it."""
    rows = (
        await session.execute(
            text(
                """
                SELECT s.*, sec.header_name, sec.header_value
                  FROM mcp_servers s
                  LEFT JOIN mcp_server_secrets sec ON sec.server_id = s.id
                 WHERE s.workspace_id = :ws
                   AND (CAST(:id AS uuid) IS NULL OR s.id = CAST(:id AS uuid))
                 ORDER BY lower(s.name), s.id
                """
            ),
            {"ws": workspace_id, "id": server_id},
        )
    ).fetchall()
    ids = [str(row.id) for row in rows]
    tools: dict[str, list[ToolView]] = {i: [] for i in ids}
    agents: dict[str, list[str]] = {i: [] for i in ids}
    if ids:
        for tool in (
            await session.execute(
                text(
                    """
                    SELECT server_id, name, title, description, read_only, policy
                      FROM mcp_server_tools WHERE server_id = ANY(CAST(:ids AS uuid[]))
                     ORDER BY server_id, position
                    """
                ),
                {"ids": ids},
            )
        ).fetchall():
            tools[str(tool.server_id)].append(
                ToolView(
                    name=tool.name,
                    title=tool.title,
                    description=tool.description,
                    read_only=tool.read_only,
                    policy=tool.policy,
                )
            )
        for grant_row in (
            await session.execute(
                text(
                    """
                    SELECT g.server_id, g.plugin_id
                      FROM agent_mcp_servers g
                     WHERE g.server_id = ANY(CAST(:ids AS uuid[]))
                     ORDER BY g.created_at
                    """
                ),
                {"ids": ids},
            )
        ).fetchall():
            agents[str(grant_row.server_id)].append(str(grant_row.plugin_id))
    out: list[ServerView] = []
    for row in rows:
        auth, header = _auth_of(row.header_name, row.header_value)
        out.append(
            ServerView(
                id=str(row.id),
                name=row.name,
                slug=row.slug,
                url=row.url,
                enabled=row.enabled,
                auth=auth,
                auth_header=header,
                era=row.era,
                protocol_version=row.protocol_version,
                server_name=row.server_name,
                server_version=row.server_version,
                checked_at=row.checked_at,
                last_error=row.last_error,
                last_error_at=row.last_error_at,
                created_at=row.created_at,
                tools=tools[str(row.id)],
                agent_ids=agents[str(row.id)],
            )
        )
    return out


async def view(session: AsyncSession, workspace_id: str, server_id: str) -> ServerView:
    found = await views(session, workspace_id, server_id)
    if not found:
        raise not_found("There is no such server.")
    return found[0]


async def granted_to(session: AsyncSession, workspace_id: str, plugin_id: str) -> list[str]:
    """The servers an agent may use, by name — for its own page."""
    rows = (
        await session.execute(
            text(
                """
                SELECT s.name FROM agent_mcp_servers g JOIN mcp_servers s ON s.id = g.server_id
                 WHERE g.plugin_id = :plugin AND g.workspace_id = :ws
                 ORDER BY lower(s.name)
                """
            ),
            {"plugin": plugin_id, "ws": workspace_id},
        )
    ).fetchall()
    return [str(row.name) for row in rows]


# ─── what a run is offered ───────────────────────────────────────────────────────────


def _endpoint(row: Any, *, allow_private: bool, probe: bool = False) -> mcp_client.Endpoint:
    """How to reach a server from its row. `probe` forgets the era the row remembers, so a
    refresh asks the server afresh which one it speaks."""
    return mcp_client.Endpoint(
        server_id=str(row.id),
        url=row.url,
        secret=(row.header_name, row.header_value) if row.header_name else None,
        era=None if probe else row.era,
        protocol_version=row.protocol_version,
        private_ok=allow_private,
    )


async def tools_for_agent(workspace_id: str, plugin_id: str) -> list[OutsideTool]:
    """The tools from servers this agent is offered, read once as a run begins.

    Only switched-on servers granted to it, only tools not `off`, in a stable order — by
    server name, then the server's own order — so a model's prompt cache sees the same
    list every run. At most `MAX_OFFERED`, and no more schema than a run should carry.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT s.id, s.name, s.slug, s.url, s.era, s.protocol_version,
                           sec.header_name, sec.header_value,
                           t.name AS tool, t.title, t.description, t.input_schema, t.policy
                      FROM agent_mcp_servers g
                      JOIN mcp_servers s ON s.id = g.server_id AND s.enabled
                      LEFT JOIN mcp_server_secrets sec ON sec.server_id = s.id
                      JOIN mcp_server_tools t ON t.server_id = s.id AND t.policy <> 'off'
                     WHERE g.plugin_id = :plugin AND g.workspace_id = :ws
                     ORDER BY lower(s.name), s.id, t.position
                    """
                ),
                {"plugin": plugin_id, "ws": workspace_id},
            )
        ).fetchall()
        if not rows:
            return []
        allow_private = await private_ok(session, workspace_id)
    offered: list[OutsideTool] = []
    taken: set[str] = set()
    size = 0
    for row in rows:
        if len(offered) >= MAX_OFFERED:
            break
        schema = row.input_schema if isinstance(row.input_schema, dict) else {}
        size += len(json.dumps(schema))
        if size > MAX_OFFERED_SCHEMA_BYTES:
            break
        name = offered_name(row.slug, row.tool, taken)
        taken.add(name)
        offered.append(
            OutsideTool(
                offered_name=name,
                server_id=str(row.id),
                server_name=row.name,
                slug=row.slug,
                name=row.tool,
                title=row.title,
                description=row.description,
                input_schema=schema,
                policy=row.policy,
                endpoint=_endpoint(row, allow_private=allow_private),
            )
        )
    return offered


async def note_failure(server_id: str, message: str) -> None:
    """Say on the server's row why it last could not be reached, for its admin."""
    async with transaction() as (session, _after):
        await session.execute(
            text(
                """
                UPDATE mcp_servers SET last_error = :message, last_error_at = now()
                 WHERE id = :id
                """
            ),
            {"id": server_id, "message": message[:500]},
        )


async def note_era(server_id: str, era: str, protocol_version: str) -> None:
    """The server answered in another era than its row said: remember, so the next call
    does not probe again."""
    async with transaction() as (session, _after):
        await session.execute(
            text(
                """
                UPDATE mcp_servers SET era = :era, protocol_version = :version
                 WHERE id = :id AND (era IS DISTINCT FROM :era
                                     OR protocol_version IS DISTINCT FROM :version)
                """
            ),
            {"id": server_id, "era": era, "version": protocol_version},
        )


def by_offered_name(tools: Sequence[OutsideTool]) -> dict[str, OutsideTool]:
    return {tool.offered_name: tool for tool in tools}


__all__ = [
    "MAX_OFFERED",
    "MAX_SERVERS",
    "POLICIES",
    "Auth",
    "OutsideTool",
    "Prepared",
    "ServerView",
    "ToolView",
    "apply_change",
    "by_offered_name",
    "change",
    "default_policy",
    "grant",
    "granted_to",
    "insert",
    "note_era",
    "note_failure",
    "offered_name",
    "prepare",
    "refresh",
    "remove",
    "revoke",
    "secret_of",
    "set_policy",
    "slug_for",
    "store_listing",
    "tools_for_agent",
    "view",
    "views",
]
