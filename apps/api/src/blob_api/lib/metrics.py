"""Numbers an operator can scrape: what agents and Blob's tools have done, and how the
server itself is answering.

`GET /metrics` (`routers/metrics.py`) serves them in Prometheus's text format to whoever
holds `METRICS_TOKEN`, and to nobody while it is unset.

The counters live in one Redis hash, because the work they count happens in more than one
process — runs in the worker, MCP calls in whichever API process took the request — and a
scrape reaches one process. Counters kept in memory would each count their own process's
share, and the one scraped would answer for all of them. In Redis every process adds to
the same numbers and any process can read them. They only ever go up, so a Redis that
comes back empty is a counter reset, which Prometheus's `rate()` expects to meet.

A write never raises. It runs once the thing it counts has committed, and a Redis that is
down loses a count rather than a run: fail toward the workspace staying up.

What is counted on every request — HTTP requests, by route template — goes through `tally`
instead: added up in the process and written to the hash every few seconds by
`flush_forever`, because a Redis round trip per request would cost more than what it
measures. And what is true of each process now — its open sockets, its database
connections — is reported by each one under its own short-lived key and summed at the
scrape, so a process that died stops counting within a minute.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .redis import redis

log = logging.getLogger("blob.metrics")

#: The hash every process counts into. Versioned, so a change to how a field is written
#: starts clean instead of mixing two shapes.
KEY = "metrics:v1"
#: How long a count may wait on Redis before it is dropped. A count is never worth
#: holding up the run or the request it counts.
WRITE_TIMEOUT_SEC = 2.0


@dataclass(frozen=True, slots=True)
class Family:
    """One metric as Prometheus sees it: a name, a type, a line of help."""

    name: str
    kind: Literal["counter", "histogram", "gauge"]
    help: str
    buckets: tuple[float, ...] = ()


RUNS = Family(
    "blob_agent_runs_total",
    "counter",
    "Agent runs, by agent and how they ended — refused ones included.",
)
RUN_SECONDS = Family(
    "blob_agent_run_duration_seconds",
    "histogram",
    "How long a run that reached its agent took, from its start to its end.",
    buckets=(0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600),
)
TOKENS = Family(
    "blob_agent_tokens_total",
    "counter",
    "Tokens agents reported using, by agent and kind.",
)
TOOL_CALLS = Family(
    "blob_tool_calls_total",
    "counter",
    "Blob's tools called, by an agent in a run or an assistant over MCP, by outcome.",
)
MCP_SERVER_CALLS = Family(
    "blob_mcp_server_calls_total",
    "counter",
    "Tools on MCP servers an admin connected, called by agents, by server, tool and outcome.",
)
IN_FLIGHT = Family("blob_agent_runs_in_flight", "gauge", "Agent runs going right now, by agent.")
WAITING = Family(
    "blob_agent_decisions_waiting",
    "gauge",
    "Runs stopped on a question nobody has answered yet, by agent.",
)

HTTP_REQUESTS = Family(
    "blob_http_requests_total",
    "counter",
    "HTTP requests answered, by method, route template and status.",
)
HTTP_SECONDS = Family(
    "blob_http_request_duration_seconds",
    "histogram",
    "How long an HTTP request took to answer, by method and route template.",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
CLIENT_ERRORS = Family(
    "blob_client_errors_total",
    "counter",
    "Errors browsers reported from the client.",
)
WEBSOCKETS = Family(
    "blob_websocket_connections",
    "gauge",
    "WebSockets open right now, over every API process.",
)
DB_CONNECTIONS = Family(
    "blob_db_pool_connections",
    "gauge",
    "Database connections the API processes hold, in use or idle.",
)
QUEUE_DEPTH = Family("blob_job_queue_depth", "gauge", "Jobs waiting in the worker's queue.")

#: What a scrape renders from the hash, in this order.
COUNTED = (
    RUNS,
    RUN_SECONDS,
    TOKENS,
    TOOL_CALLS,
    MCP_SERVER_CALLS,
    HTTP_REQUESTS,
    HTTP_SECONDS,
    CLIENT_ERRORS,
)

#: Each process's own numbers, under its own key, gone a minute after it stops reporting.
PROCESS_KEY = "metrics:process:"
PROCESS_TTL_SEC = 60
#: How often `flush_forever` writes the tally and reports the process.
FLUSH_EVERY_SEC = 5.0


def _escape(value: str) -> str:
    """A label value as the text format quotes it."""
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(labels: Mapping[str, str]) -> str:
    if not labels:
        return ""
    inner = ",".join(f'{key}="{_escape(str(value))}"' for key, value in sorted(labels.items()))
    return "{" + inner + "}"


def _bound(value: float) -> str:
    return "+Inf" if math.isinf(value) else f"{value:g}"


async def _bounded(write: Callable[[], Awaitable[Any]], what: str) -> None:
    """Run one write against Redis, briefly. The write is made inside the guard, so a
    client that fails before it returns anything to await is caught as well."""
    try:
        await asyncio.wait_for(write(), WRITE_TIMEOUT_SEC)
    except Exception:
        log.debug("could not count %s", what, exc_info=True)


async def count(family: Family, labels: Mapping[str, str], by: float = 1) -> None:
    """Add to a counter. Never raises, and never waits long."""
    if by <= 0:
        return
    field = family.name + _labels(labels)
    await _bounded(lambda: redis.hincrbyfloat(KEY, field, by), family.name)  # type: ignore[arg-type,return-value]


async def observe(family: Family, labels: Mapping[str, str], value: float) -> None:
    """Put one value into a histogram. Never raises.

    Every bucket is written on every observation — by one where the value fits, by
    nothing where it does not — so a series has all its buckets from its first value:
    a histogram missing its lower buckets reads as having no data there, not as zero.
    """
    if value < 0 or math.isnan(value):
        return

    def write() -> Awaitable[Any]:
        pipe = redis.pipeline(transaction=False)
        for bound in (*family.buckets, math.inf):
            field = f"{family.name}_bucket" + _labels({**labels, "le": _bound(bound)})
            pipe.hincrbyfloat(KEY, field, 1 if value <= bound else 0)
        pipe.hincrbyfloat(KEY, f"{family.name}_sum" + _labels(labels), value)
        pipe.hincrbyfloat(KEY, f"{family.name}_count" + _labels(labels), 1)
        return pipe.execute()

    await _bounded(write, family.name)


class Tally:
    """Counts kept in this process and added to the shared hash in one pipeline at a
    time — for what happens on every request."""

    def __init__(self) -> None:
        self._pending: defaultdict[str, float] = defaultdict(float)

    def count(self, family: Family, labels: Mapping[str, str], by: float = 1) -> None:
        if by > 0:
            self._pending[family.name + _labels(labels)] += by

    def observe(self, family: Family, labels: Mapping[str, str], value: float) -> None:
        """As `observe`, without the round trip: every bucket written, so a series has
        all of them from its first value."""
        if value < 0 or math.isnan(value):
            return
        for bound in (*family.buckets, math.inf):
            field = f"{family.name}_bucket" + _labels({**labels, "le": _bound(bound)})
            self._pending[field] += 1 if value <= bound else 0
        self._pending[f"{family.name}_sum" + _labels(labels)] += value
        self._pending[f"{family.name}_count" + _labels(labels)] += 1

    async def flush(self) -> None:
        """Write what has been counted since the last flush. Never raises; a Redis that
        is down loses this batch, as a direct write would have lost its one count."""
        if not self._pending:
            return
        pending, self._pending = self._pending, defaultdict(float)

        def write() -> Awaitable[Any]:
            pipe = redis.pipeline(transaction=False)
            for field, value in pending.items():
                pipe.hincrbyfloat(KEY, field, value)
            return pipe.execute()

        await _bounded(write, "the tally")


#: This process's tally. The request middleware counts into it.
tally = Tally()


async def report_process(process_id: str, numbers: Mapping[str, int]) -> None:
    """This process's gauges now — open sockets, database connections — under its own
    key, which expires if the process stops reporting."""
    key = PROCESS_KEY + process_id

    def write() -> Awaitable[Any]:
        pipe = redis.pipeline(transaction=False)
        pipe.hset(key, mapping={name: str(value) for name, value in numbers.items()})
        pipe.expire(key, PROCESS_TTL_SEC)
        return pipe.execute()

    await _bounded(write, "this process")


async def processes() -> dict[str, int]:
    """Every live process's gauges, added up."""
    total: defaultdict[str, int] = defaultdict(int)
    async for key in redis.scan_iter(match=PROCESS_KEY + "*", count=100):
        numbers: dict[Any, Any] = await redis.hgetall(key)  # type: ignore[misc]
        for name, value in numbers.items():
            label = name.decode() if isinstance(name, bytes) else str(name)
            try:
                total[label] += int(float(value))
            except (TypeError, ValueError):
                continue
    return dict(total)


async def flush_forever(process_id: str, report: Callable[[], Mapping[str, int]]) -> None:
    """The API process's loop: the tally into the hash, and this process's gauges under
    its key, every few seconds until it is cancelled — and once more on the way out."""
    try:
        while True:
            await asyncio.sleep(FLUSH_EVERY_SEC)
            await tally.flush()
            await report_process(process_id, report())
    finally:
        await tally.flush()


async def run_ended(
    agent: str,
    status: str,
    *,
    seconds: float | None = None,
    usage: Sequence[Mapping[str, Any]] | None = None,
) -> None:
    """A run's ending, counted: its status, how long it took, what it spent."""
    labels = {"agent": agent}
    await count(RUNS, {**labels, "status": status})
    if seconds is not None:
        await observe(RUN_SECONDS, labels, seconds)
    for entry in usage or ():
        for key, kind in (("inputTokens", "input"), ("outputTokens", "output")):
            spent = entry.get(key)
            if isinstance(spent, int) and not isinstance(spent, bool) and spent > 0:
                await count(TOKENS, {**labels, "type": kind}, spent)


async def model_called(input_tokens: int, output_tokens: int) -> None:
    """One of Blob's own model calls (the catch-up, a thread summary), counted beside the
    agents' tokens under the agent name `blob` — the part of the bill that is Blob's."""
    for kind, spent in (("input", input_tokens), ("output", output_tokens)):
        if spent > 0:
            await count(TOKENS, {"agent": "blob", "type": kind}, spent)


async def tool_called(via: Literal["agent", "mcp"], tool: str, outcome: str) -> None:
    """One call to one of Blob's tools, and what came of it."""
    await count(TOOL_CALLS, {"via": via, "tool": tool, "outcome": outcome})


async def outside_tool_called(server: str, tool: str, outcome: str) -> None:
    """One call to a tool on an MCP server an admin connected (ADR 0027), by the server's
    slug and the tool's own name: `asked` when it was put to the person, then what came of
    it — `ok`, `refused`, `failed`, `declined`."""
    await count(MCP_SERVER_CALLS, {"server": server, "tool": tool[:128], "outcome": outcome})


def _sample_name(field: str) -> str:
    brace = field.find("{")
    return field if brace < 0 else field[:brace]


def _sort_key(family: Family, field: str) -> tuple[Any, ...]:
    """Buckets in order of their bound, then the sum and the count, per label set."""
    name = _sample_name(field)
    labels = field[len(name) :]
    if family.kind != "histogram":
        return (labels,)
    le = math.inf
    without_le = labels
    marker = ',le="' if ',le="' in labels else '{le="'
    at = labels.find(marker)
    if at >= 0:
        end = labels.find('"', at + len(marker))
        raw = labels[at + len(marker) : end]
        le = math.inf if raw == "+Inf" else float(raw)
        without_le = labels[:at] + labels[end + 1 :]
        if without_le == "}":
            without_le = ""  # `le` was the only label, as it is on no family yet.
    order = {"_bucket": 0, "_sum": 1, "_count": 2}[name[len(family.name) :]]
    return (without_le, order, le)


def _family_lines(family: Family, samples: Iterable[tuple[str, str]]) -> list[str]:
    lines = [f"# HELP {family.name} {family.help}", f"# TYPE {family.name} {family.kind}"]
    lines.extend(
        f"{field} {value}"
        for field, value in sorted(samples, key=lambda item: _sort_key(family, item[0]))
    )
    return lines


def _belongs(family: Family, field: str) -> bool:
    name = _sample_name(field)
    if family.kind == "histogram":
        return name in (f"{family.name}_bucket", f"{family.name}_sum", f"{family.name}_count")
    return name == family.name


async def render(
    gauges: Mapping[Family, Mapping[str, int]],
    server: Sequence[tuple[Family, Mapping[str, str], float]] = (),
) -> str:
    """The text a scrape gets: the counters every process shares, the gauges the caller
    read just now keyed by agent, and the server's own gauges with their labels.

    Raises if Redis cannot be read — a scrape that silently returned no counters would
    graph as everything having stopped.
    """
    stored: dict[str, str] = await redis.hgetall(KEY)  # type: ignore[misc]
    lines: list[str] = []
    for family in COUNTED:
        lines.extend(
            _family_lines(family, ((f, v) for f, v in stored.items() if _belongs(family, f)))
        )
    for family, by_agent in gauges.items():
        samples = [(family.name + _labels({"agent": a}), str(n)) for a, n in by_agent.items()]
        lines.extend(_family_lines(family, samples))
    grouped: dict[Family, list[tuple[str, str]]] = {}
    for family, labels, value in server:
        grouped.setdefault(family, []).append((family.name + _labels(labels), f"{value:g}"))
    for family, samples in grouped.items():
        lines.extend(_family_lines(family, samples))
    return "\n".join(lines) + "\n"
