"""What a plugin declares about itself.

One manifest describes both runtimes. A local plugin and an external app ask for the
same scopes, subscribe to the same events and appear identically in the console; the
only difference is where the code runs, and that is a single field.

Scopes are an ergonomics and audit boundary for local plugins, and a real one for
external apps. The distinction is stated plainly in the docs rather than implied: a local
plugin runs in this process and can read the environment, so its grants describe intent,
not capability.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, field_validator

from ..lib.errors import bad_request
from ..schemas.base import CamelModel

#: Where the code runs. "container" is an external app whose hosting Blob arranged —
#: same contract, same scopes, same delivery; see ADR 0010.
#:
#: "socket" is the one that reverses who dials. Every other runtime is reached by Blob
#: making a request to an address; a socket agent has no address to give — it runs on
#: somebody's laptop, behind NAT, on a network this server cannot see — so it opens a
#: connection *to* Blob and holds it, and runs are written down that pipe. See ADR 0012.
#:
#: "builtin" is the agent Blob runs itself: an AG-UI server that never leaves the
#: process, so there is no address at either end. It is a plugin like any other on
#: purpose — same scopes, same bot row, same run log, and an admin can disable it —
#: because the one agent that ships turned on is the last one that should be exempt from
#: the permission system. Registered by Blob, never by a manifest off the wire.
Runtime = Literal["local", "external", "container", "socket", "builtin"]
Status = Literal["enabled", "disabled", "needs_review", "failed"]

#: Every permission a plugin can hold. Granted as a set at install, one row each, so a
#: single scope can be revoked without rewriting the rest.
SCOPES: dict[str, str] = {
    "messages:read": "Read messages in channels it belongs to",
    "messages:write": "Post messages",
    "messages:moderate": "Edit and delete anyone's messages",
    "reactions:write": "Add and remove reactions",
    "channels:read": "See channels it belongs to",
    "channels:write": "Create channels and edit their topics",
    "channels:join": "Join and leave channels",
    "users:read": "See who is in the workspace",
    "users:read.email": "See people's email addresses",
    "users:manage": "Change roles and deactivate people",
    "tasks:read": "Read agent task assignments and status",
    "tasks:write": "Create and update agent tasks",
    "summaries:read": "Read thread summaries",
    "summaries:write": "Generate thread summaries",
    "files:read": "Download attachments",
    "files:write": "Upload attachments",
    "admin:read": "Read workspace settings and the audit log",
    "admin:write": "Change workspace settings",
    "commands": "Provide slash commands",
    "store": "Keep its own private key-value data",
    "schedule": "Run work on a timer",
}

#: Events a plugin can subscribe to.
#:
#: Presence, typing and read state are deliberately absent and will stay absent: they
#: reveal who is at their desk minute by minute, and nothing a plugin legitimately does
#: needs that.
EVENTS: dict[str, str] = {
    "message.created": "A message was posted",
    "message.updated": "A message was edited",
    "message.deleted": "A message was deleted",
    "reaction.added": "Someone reacted to a message",
    "reaction.removed": "Someone removed a reaction",
    "channel.created": "A channel was created",
    "member.joined": "Someone joined a channel",
    "member.left": "Someone left a channel",
    "task.created": "An agent task was created",
    "task.updated": "An agent task changed state",
    "thread.summary.updated": "A thread summary was generated or refreshed",
    "interaction.triggered": "Someone used a button or select in one of its messages",
}

#: Which scope an event requires. Subscribing to message events without being allowed to
#: read messages is a contradiction worth refusing at install rather than at delivery.
EVENT_SCOPES: dict[str, str] = {
    "message.created": "messages:read",
    "message.updated": "messages:read",
    "message.deleted": "messages:read",
    "reaction.added": "messages:read",
    "reaction.removed": "messages:read",
    "channel.created": "channels:read",
    "member.joined": "channels:read",
    "member.left": "channels:read",
    "task.created": "tasks:read",
    "task.updated": "tasks:read",
    "thread.summary.updated": "summaries:read",
    # An app only ever receives interactions on its own messages, so the scope that
    # matters is the one that let it post them.
    "interaction.triggered": "messages:write",
}

_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,38}[a-z0-9]$")
_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
#: A command name, without its slash. Deliberately the same shape the built-in parser
#: accepts, or an app could register a name nobody is able to type.
_COMMAND_RE = re.compile(r"^[a-z][a-z0-9_-]{0,30}$")


class CommandDecl(CamelModel):
    """One slash command an app provides."""

    name: str
    #: Argument shape shown in the composer, e.g. `<repo>` or `[query]`.
    usage: str = Field(default="", max_length=60)
    summary: str = Field(min_length=1, max_length=140)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        value = value.strip().lstrip("/").lower()
        if not _COMMAND_RE.match(value):
            raise ValueError(
                "A command name is 1-31 characters: lowercase letters, numbers, "
                "hyphens and underscores, starting with a letter."
            )
        return value


class Manifest(CamelModel):
    """The registration payload. Also the shape a local plugin's `plugin.toml` parses to."""

    slug: str
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    runtime: Runtime = "external"
    version: str = "0.0.0"
    #: Where events are POSTed. External apps only; validated against the SSRF guard. A
    #: container agent gets one once the runner has assigned it a hostname.
    request_url: str | None = None
    #: A standard AG-UI endpoint: Blob POSTs a RunAgentInput and reads back an SSE event
    #: stream. An app with one of these needs no webhook handler and no bot token to
    #: answer a mention — Blob calls it and writes what comes back. Validated against the
    #: same SSRF guard as `request_url`.
    agui_url: str | None = None
    #: Where AG-UI lives *on* the agent, for an agent whose address Blob assigns.
    #:
    #: A hosted agent cannot declare `agui_url`: the runner invents the hostname at deploy
    #: time, so at the moment the manifest is written there is no URL to write. Until this
    #: existed that was fatal rather than awkward — `listeners_for` admits a plugin only
    #: when `agui_url IS NOT NULL` or the runtime dials in, so a deployed AG-UI agent was
    #: never a listener and every mention of it did nothing, silently. A path is knowable
    #: in advance; Blob joins it to the base the runner hands back.
    agui_path: str | None = None
    #: What the agent listens on inside its container. Told to the runner so its proxy
    #: routes there, and to the agent as PORT so it need not guess what we told the proxy.
    #: Declared because agents disagree: Janus serves 8642, and an agent reached on the
    #: wrong port is indistinguishable from one that failed to start.
    port: int | None = Field(default=None, ge=1, le=65535)
    events: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    #: Slash commands this app answers. Names are unique per workspace, which is enforced
    #: by an index rather than a check — two apps installed at the same moment would both
    #: pass a check and only one can hold the name.
    commands: list[CommandDecl] = Field(default_factory=list, max_length=25)

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, value: str) -> str:
        value = value.strip().lower()
        if not _SLUG_RE.match(value):
            raise ValueError("A slug is 3-40 characters of lowercase letters, numbers and hyphens.")
        return value

    @field_validator("version")
    @classmethod
    def _check_version(cls, value: str) -> str:
        if not _VERSION_RE.match(value):
            raise ValueError("Version must look like 1.2.3.")
        return value

    @field_validator("agui_path")
    @classmethod
    def _check_agui_path(cls, value: str | None) -> str | None:
        """A path, and only a path.

        The whole point is that the agent does not choose its own host. Accepting
        anything with a scheme or an authority would hand back the ability this field
        exists to remove — `//evil.example/x` is a protocol-relative URL, not a path, and
        is the shape that slips past a check for `http`.
        """
        if value is None:
            return None
        path = value.strip()
        if not path:
            return None
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError('An AG-UI path starts with "/" and names no host, e.g. "/v1/agui".')
        if "://" in path or "\\" in path:
            raise ValueError("An AG-UI path is a path, not a URL.")
        return path.rstrip("/") or "/"


def validate_manifest(
    manifest: Manifest,
    *,
    reserved_commands: frozenset[str] = frozenset(),
    trusted: bool = False,
) -> None:
    """Reject what would otherwise fail later, at delivery time, in a background job.

    `reserved_commands` is passed in rather than imported: the built-ins live in
    `services.commands`, and this layer is below that one — `plugins/` importing a
    service would invert the dependency that keeps the plugin layer independent of it.
    Every install site supplies the same set.

    `trusted` says the manifest came from Blob rather than off the wire, and it defaults
    to false so that a new call site is refused rather than admitted. Only the built-in
    agent's own seeding sets it.
    """
    # The built-in runtime runs against the *server's* model key. A manifest that could
    # claim it would let anyone who can register an app spend that budget, which is not a
    # scope question — no grant is involved — so it is refused by runtime, at the door.
    if manifest.runtime == "builtin" and not trusted:
        raise bad_request(
            "That runtime is Blob's own and cannot be registered.", code="runtime_reserved"
        )

    unknown_scopes = sorted(set(manifest.scopes) - set(SCOPES))
    if unknown_scopes:
        raise bad_request(f"Unknown scope: {', '.join(unknown_scopes)}.", code="unknown_scope")

    unknown_events = sorted(set(manifest.events) - set(EVENTS))
    if unknown_events:
        raise bad_request(f"Unknown event: {', '.join(unknown_events)}.", code="unknown_event")

    granted = set(manifest.scopes)
    for event in manifest.events:
        required = EVENT_SCOPES[event]
        if required not in granted:
            raise bad_request(
                f"Subscribing to {event} needs the {required} scope.",
                code="scope_required",
            )

    # Either transport satisfies this: an AG-UI app is reached by Blob calling it, so it
    # has no webhook to declare. The error code is unchanged — it is part of somebody
    # else's contract.
    if manifest.runtime == "external" and not (manifest.request_url or manifest.agui_url):
        raise bad_request("An external app needs a request URL.", code="url_required")

    # A dial-in agent holds one socket that carries runs and their answers. There is no
    # frame for a webhook delivery and no frame for a slash command, so both of these
    # install perfectly and then do nothing at all — subscriptions pile up `pending`
    # deliveries forever, and a command *squats its name* workspace-wide (the name is
    # unique per workspace) while refusing to answer. Refused at the door instead, because
    # a dead subscription is indistinguishable from a broken one.
    if manifest.runtime == "socket":
        if manifest.events:
            raise bad_request(
                "An agent that connects to Blob cannot subscribe to events — it is sent "
                "runs when it is mentioned, and there is nothing to deliver a webhook to.",
                code="events_not_supported",
            )
        if manifest.commands:
            raise bad_request(
                "An agent that connects to Blob cannot provide slash commands. Mention it instead.",
                code="commands_not_supported",
            )

    if manifest.commands:
        if "commands" not in granted:
            raise bad_request(
                "Providing slash commands needs the commands scope.", code="scope_required"
            )
        # An app that answers a command has to be reachable to be asked.
        if manifest.runtime == "external" and not manifest.request_url:
            raise bad_request(
                "An app with slash commands needs a request URL to be asked at.",
                code="url_required",
            )

        names = [c.name for c in manifest.commands]
        duplicates = sorted({n for n in names if names.count(n) > 1})
        if duplicates:
            raise bad_request(
                f"Declared twice: /{', /'.join(duplicates)}.", code="duplicate_command"
            )

        clashes = sorted(set(names) & reserved_commands)
        if clashes:
            raise bad_request(
                f"/{', /'.join(clashes)} is built in and cannot be replaced.",
                code="command_reserved",
            )


def new_scopes(previous: list[str], requested: list[str]) -> list[str]:
    """Scopes an update asks for that were not already granted.

    A version bump that widens permissions moves the plugin to `needs_review` and stops
    its events until someone approves — an app must not be able to grant itself more by
    shipping an update.
    """
    return sorted(set(requested) - set(previous))
