"""The three ways an agent's AG-UI stream reaches Blob.

One contract, three transports: an HTTP POST to the agent's endpoint (the direction
every agent framework ships), the reversed socket for an agent with no address
(ADR 0012), and the in-process builtin. Each returns the same `(fold, posts, error)`
triple, so the job that answers a mention does not care where the agent lives.

Lives in plugins/ rather than jobs/ because it is transport, not orchestration — and
because the socket half already had its other end here.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import settings
from ..lib import sse
from . import agui, builtin, gateway
from .signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, sign

log = logging.getLogger("blob.plugins.streams")


@dataclass(slots=True)
class Listener:
    plugin_id: str
    slug: str
    name: str
    bot_user_id: str
    #: None for a socket agent, which has no address — it dialled us. See `plugins/gateway`.
    agui_url: str | None
    signing_secret: str
    runtime: str = "external"
    #: Only read for the built-in agent, which is told where it works. An external agent
    #: is somebody else's program and is given the channel, not the workspace.
    workspace_name: str = ""
    #: Set only in a personal-agent DM: the one person on the other side. It is what turns
    #: the workspace agent into *your* agent, and it is a name rather than an id because
    #: the only thing downstream does with it is tell the model whose room this is.
    owner_name: str | None = None

    @property
    def dials_in(self) -> bool:
        return self.runtime == "socket"

    @property
    def runs_here(self) -> bool:
        return self.runtime == builtin.RUNTIME

    @property
    def transport(self) -> str:
        if self.runs_here:
            return "builtin"
        return "socket" if self.dials_in else "http"




async def stream_run(
    listener: Listener,
    run_input: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[agui.Fold, list[agui.Post], str | None]:
    """Call the agent and fold its stream. Returns (fold, messages to post, error).

    The posts are collected as they are sealed rather than gathered at the end: a
    message is emitted by `feed` the moment its TEXT_MESSAGE_END arrives, so a caller
    that only read `finish()` would post the last message and silently drop the rest.

    The body is signed exactly as a webhook delivery is — same header names, same `v0=`
    scheme — so an app that already verifies Blob's deliveries verifies this with the
    code it has.
    """
    if listener.runs_here:
        return await _stream_builtin(listener, run_input)
    if listener.dials_in:
        return await _stream_over_socket(listener, run_input)

    fold = agui.Fold()
    posts: list[agui.Post] = []
    if listener.agui_url is None:
        # `listeners_for` admits an agent with no URL only when it dials in, so this is
        # unreachable rather than merely unlikely — it is here because the type says the
        # field is optional and silently POSTing to None is the worse way to find out.
        return fold, posts, "that agent has no endpoint to call"
    decoder = sse.SseDecoder()
    body = json.dumps(run_input).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "accept": "text/event-stream",
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: sign(listener.signing_secret, timestamp, body),
    }

    seen_events = 0
    seen_bytes = 0
    timeout = httpx.Timeout(settings.AGUI_TIMEOUT_SEC, read=settings.AGUI_READ_TIMEOUT_SEC)

    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            async with client.stream(
                "POST", listener.agui_url, content=body, headers=headers
            ) as response:
                if response.status_code >= 400:
                    return fold, posts, f"the agent answered {response.status_code}"
                async for chunk in response.aiter_bytes():
                    seen_bytes += len(chunk)
                    if seen_bytes > settings.AGUI_MAX_BYTES:
                        posts.extend(fold.finish())
                        return fold, posts, "the agent sent more than we will read"
                    for event in decoder.feed(chunk):
                        seen_events += 1
                        if seen_events > settings.AGUI_MAX_EVENTS:
                            posts.extend(fold.finish())
                            return fold, posts, "the agent sent more events than we will read"
                        posts.extend(fold.feed(event))
                        if fold.finished:
                            return fold, posts, None
                for event in decoder.close():
                    posts.extend(fold.feed(event))
    except httpx.TimeoutException:
        posts.extend(fold.finish())
        return fold, posts, "the agent did not finish in time"
    except httpx.HTTPError as error:
        posts.extend(fold.finish())
        return fold, posts, f"the agent could not be reached: {error}"

    # A stream that ended without RUN_FINISHED is treated as done, not as an error: an
    # answer that arrived in full should not get an apology appended under it.
    posts.extend(fold.finish())
    return fold, posts, None


def _rough_size(event: Mapping[str, Any]) -> int:
    """About how big this event was, without paying to re-serialise it.

    The HTTP path counts the bytes it actually read. Here the frame was already decoded
    by the time it arrived, so the choice is between re-encoding every event to be exact
    or estimating. This is a containment bound, not accounting: the text deltas are what
    grow without limit and this counts them, and being off by the JSON punctuation on a
    2 MiB budget changes nothing anyone can observe.
    """
    total = 0
    for value in event.values():
        if isinstance(value, str):
            total += len(value)
        elif isinstance(value, list | dict):
            total += len(str(value))
        else:
            total += 8
    return total


async def _stream_over_socket(
    listener: Listener, run_input: dict[str, Any]
) -> tuple[agui.Fold, list[agui.Post], str | None]:
    """The same run, down a connection the agent opened, from a process that is not this one.

    Everything after "where do the events come from" is identical to the HTTP path on
    purpose — the same `Fold`, the same caps, the same treatment of a stream that stops
    early. `plugins/agui.py` is a pure function of events precisely so that a second
    transport costs this much and no more.

    There is no signature here, and that is not an omission. A signature proves to the
    *agent* that a request came from Blob, which matters when anyone on the internet can
    POST to its URL. This agent authenticated itself with its bot token when it dialled
    in, and the socket it is holding is the proof — nobody else can write to it.
    """
    fold = agui.Fold()
    posts: list[agui.Post] = []

    if not await gateway.is_online(listener.plugin_id):
        return fold, posts, "that agent is not connected right now"

    seen_events = 0
    seen_bytes = 0
    try:
        async for event in gateway.stream_events(
            listener.plugin_id, run_input, timeout_sec=gateway.run_timeout_sec()
        ):
            seen_events += 1
            if seen_events > settings.AGUI_MAX_EVENTS:
                posts.extend(fold.finish())
                return fold, posts, "the agent sent more events than we will read"
            # The HTTP path caps bytes as well as events and this did not, which left the
            # ceiling at events times frame size — half a megabyte each, gigabytes
            # through the worker for one run. Both caps exist because an agent can be
            # wrong in either direction: many tiny events, or few enormous ones.
            seen_bytes += _rough_size(event)
            if seen_bytes > settings.AGUI_MAX_BYTES:
                posts.extend(fold.finish())
                return fold, posts, "the agent sent more than we will read"
            posts.extend(fold.feed(event))
            if fold.finished:
                return fold, posts, None
    except Exception as error:
        posts.extend(fold.finish())
        return fold, posts, f"the agent could not be reached: {error}"

    if not fold.finished and not posts:
        # Nothing at all came back inside the window. Distinguished from a short answer
        # because "it said nothing" and "it never woke up" want different apologies.
        posts.extend(fold.finish())
        return fold, posts, "the agent did not answer in time"

    posts.extend(fold.finish())
    return fold, posts, None


async def _stream_builtin(
    listener: Listener, run_input: dict[str, Any]
) -> tuple[agui.Fold, list[agui.Post], str | None]:
    """The same run, against a model, without leaving the process.

    A third transport for the third time, and it costs the same as the second one did:
    the same `Fold`, the same caps, the same treatment of a stream that stops early.
    `plugins/agui.py` being a pure function of events is what keeps adding one to this
    list a dozen lines rather than a parallel path — and it is why the run log, the 12k
    split and the ten-message cap all applied to this agent before it existed.

    No signature and no SSRF guard, because there is no request. Both of those exist to
    make a hop across a network safe, and this one has no hop.
    """
    fold = agui.Fold()
    posts: list[agui.Post] = []
    persona = builtin.Persona(
        name=listener.name,
        workspace_name=listener.workspace_name,
        owner_name=listener.owner_name,
    )

    seen_events = 0
    try:
        async for event in builtin.stream(run_input, persona):
            seen_events += 1
            if seen_events > settings.AGUI_MAX_EVENTS:
                posts.extend(fold.finish())
                return fold, posts, "the agent sent more events than we will read"
            posts.extend(fold.feed(event))
            if fold.finished:
                return fold, posts, None
    except Exception as error:
        # `builtin.stream` turns a model failure into RUN_ERROR itself, so reaching here
        # means a bug rather than a refusal. It still must not take the worker down: a
        # broken built-in agent degrades to a run that failed with a reason, like any
        # other agent that misbehaves.
        log.exception("the built-in agent failed")
        posts.extend(fold.finish())
        return fold, posts, f"the agent failed: {error}"

    posts.extend(fold.finish())
    return fold, posts, None
