"""The two ways an agent's AG-UI stream reaches Blob.

One contract, two transports: an HTTP POST to the agent's endpoint (the direction every
agent framework ships), and the reversed socket for an agent with no address (ADR 0012).
Both return the same `(fold, posts, error)` triple, so the job that answers a mention does
not care where the agent lives.

Lives in plugins/ rather than jobs/ because it is transport, not orchestration — and
because the socket half already had its other end here.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import settings
from ..lib import sse, telemetry
from . import agui, gateway
from .signing import signed_headers


def read_budget() -> int:
    """How many bytes of one run's stream Blob will read, on either transport.

    The text ceiling was the whole budget until an agent could hand over a file, and a
    file is bigger than any answer. The files' own budget is added as it travels —
    base64, four bytes for every three — so a run carrying its full allowance of files
    still fits, and a run flooding text alone is cut where it always was plus that
    allowance. The Fold enforces the file budget itself; this is the containment bound.
    """
    as_base64 = 4 * -(-settings.AGUI_MAX_FILE_BYTES // 3)
    return settings.AGUI_MAX_BYTES + as_base64


#: What the card says when a socket agent is not there to take the run.
NOT_CONNECTED = "that agent is not connected right now"


def _fold(run_input: Mapping[str, Any]) -> agui.Fold:
    """A fold that starts from the state the run was sent.

    AG-UI's `STATE_DELTA` patches the state the agent was *given*. Starting from nothing
    made every delta-only run fail to apply its first patch, and the memory it meant to
    leave was lost.
    """
    return agui.Fold(max_file_bytes=settings.AGUI_MAX_FILE_BYTES, state=run_input.get("state"))


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
    #: What this workspace tells this agent, sent with the run as
    #: `forwardedProps.instructions`. None when the workspace has nothing to say —
    #: `plugins.instructions`, read by both admission paths.
    instructions: str | None = None
    #: Whether the live card keeps a tail of the agent's reasoning. Off unless the
    #: agent's row turns it on; see `run_card.CardFold`.
    shows_reasoning: bool = False
    #: Whose agent this is: None for the workspace's, a person's id for theirs (ADR 0018).
    #: Decides whose runs may read and write what it remembers.
    owner_user_id: str | None = None
    #: The AG-UI version the agent last declared, or None if it never has. Decides
    #: whether a run is sent 1.0's input fields; see `agui.speaks`.
    agui_version: str | None = None
    #: What it may do with Blob's tools: `none`, `read` or `write` (ADR 0022).
    tool_access: str = "none"
    #: Which of its posts wait for the person: `ask`, `auto_in_dm`, `auto_everywhere`.
    write_approval: str = "ask"

    def memory_of(self, person_id: str) -> str | None:
        """Whose memory a run on this person's behalf reads and writes (migration 0050).

        None — the conversation's — for the workspace's agent: anyone's run there uses it.
        The person's own for an agent somebody owns, its owner and each borrower alike: a
        loan lends the agent, not what it remembers of its owner's work, and the
        borrower's runs build a memory of their own instead of going without one.
        """
        return None if self.owner_user_id is None else person_id

    @property
    def dials_in(self) -> bool:
        return self.runtime == "socket"

    @property
    def transport(self) -> str:
        return "socket" if self.dials_in else "http"


async def stream_run(
    listener: Listener,
    run_input: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    on_event: Callable[[Mapping[str, Any]], None] | None = None,
    wall_sec: float | None = None,
) -> tuple[agui.Fold, list[agui.Post], str | None]:
    """Call the agent and fold its stream. Returns (fold, messages to post, error).

    `wall_sec` is how long this stream may take at most, when less than the run's own
    wall is left — a run that used Blob's tools streams several times, and its wall
    covers all of them (ADR 0022).

    The posts are collected as they are sealed rather than gathered at the end: a
    message is emitted by `feed` the moment its TEXT_MESSAGE_END arrives, so a caller
    that only read `finish()` would post the last message and silently drop the rest.

    The body is signed exactly as a webhook delivery is — same header names, same `v0=`
    scheme — so an app that already verifies Blob's deliveries verifies this with the
    code it has. With tracing on, the request carries the run's `traceparent` too, which
    the signature does not cover and does not need to: it names a trace, not an order.
    """
    wall = (
        settings.AGUI_MAX_RUN_SEC if wall_sec is None else min(wall_sec, settings.AGUI_MAX_RUN_SEC)
    )
    if listener.dials_in:
        return await _stream_over_socket(listener, run_input, on_event=on_event, wall_sec=wall)

    fold = _fold(run_input)
    posts: list[agui.Post] = []
    if listener.agui_url is None:
        # Both admission paths — `listeners_for` for a mention, `personal_agent_for` for
        # a DM that is its own address — filter on `MENTIONABLE_AGENT`, which admits an
        # agent with no URL only when it dials in. So this is unreachable rather than
        # merely unlikely, and it is here because the type says the field is optional and
        # silently POSTing to None is the worse way to find out.
        return fold, posts, "that agent has no endpoint to call"
    decoder = sse.SseDecoder()
    body = json.dumps(run_input).encode()
    headers = {
        **signed_headers(listener.signing_secret, body),
        "accept": "text/event-stream",
    }
    telemetry.inject(headers)

    seen_events = 0
    seen_bytes = 0
    # `AGUI_TIMEOUT_SEC` bounds reaching the agent and each write; the read timeout is
    # the *idle* gap between chunks — a chunk resets it, which is httpx's semantics
    # already. The absolute wall is AGUI_MAX_RUN_SEC, checked per chunk below, so a
    # visibly-working agent can run for minutes without the old 120s total ceiling.
    timeout = httpx.Timeout(settings.AGUI_TIMEOUT_SEC, read=settings.AGUI_READ_TIMEOUT_SEC)
    started = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            async with client.stream(
                "POST", listener.agui_url, content=body, headers=headers
            ) as response:
                if response.status_code >= 400:
                    fold.rejected_status = response.status_code
                    return fold, posts, f"the agent answered {response.status_code}"
                async for chunk in response.aiter_bytes():
                    if time.monotonic() - started > wall:
                        posts.extend(fold.finish())
                        return fold, posts, "the agent ran past the ceiling"
                    seen_bytes += len(chunk)
                    if seen_bytes > read_budget():
                        posts.extend(fold.finish())
                        return fold, posts, "the agent sent more than we will read"
                    for event in decoder.feed(chunk):
                        seen_events += 1
                        if seen_events > settings.AGUI_MAX_EVENTS:
                            posts.extend(fold.finish())
                            return fold, posts, "the agent sent more events than we will read"
                        if on_event is not None:
                            on_event(event)
                        posts.extend(fold.feed(event))
                        if fold.finished:
                            return fold, posts, None
                for event in decoder.close():
                    if on_event is not None:
                        on_event(event)
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
    listener: Listener,
    run_input: dict[str, Any],
    *,
    on_event: Callable[[Mapping[str, Any]], None] | None = None,
    wall_sec: float | None = None,
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
    fold = _fold(run_input)
    posts: list[agui.Post] = []

    if not await gateway.is_online(listener.plugin_id):
        return fold, posts, NOT_CONNECTED

    seen_events = 0
    seen_bytes = 0
    try:
        async for event in gateway.stream_events(
            listener.plugin_id,
            run_input,
            timeout_sec=gateway.run_timeout_sec(),
            wall_sec=wall_sec,
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
            if seen_bytes > read_budget():
                posts.extend(fold.finish())
                return fold, posts, "the agent sent more than we will read"
            if on_event is not None:
                on_event(event)
            posts.extend(fold.feed(event))
            if fold.finished:
                return fold, posts, None
    except gateway.AgentNotConnectedError:
        # The presence key said yes and the publish reached nobody: the holder died
        # inside the key's TTL. Said now rather than after the idle window.
        return fold, posts, NOT_CONNECTED
    except gateway.RunTimedOutError as timed_out:
        # Cut off, which is a failure even with text in hand — the same answer the HTTP
        # path gives a read that timed out. What did arrive is still posted, with the
        # card saying the run did not finish, rather than passed off as a whole answer.
        posts.extend(fold.finish())
        if seen_events == 0:
            # Nothing at all came back. "It never woke up" and "it stopped mid-answer"
            # want different words on the card.
            return fold, posts, "the agent did not answer in time"
        return fold, posts, timed_out.reason
    except Exception as error:
        posts.extend(fold.finish())
        return fold, posts, f"the agent could not be reached: {error}"

    # The agent said `done`. Without RUN_FINISHED that is still the end of the run, as an
    # HTTP stream that closes cleanly is — and a run that said nothing before it posts
    # nothing, which is a legitimate answer on both transports.
    posts.extend(fold.finish())
    return fold, posts, None
