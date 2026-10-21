"""Traces of what agents do, for an operator who has somewhere to send them.

Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set in
the environment. Unset, the SDK is never configured: OpenTelemetry's API hands back
non-recording spans, `inject` writes nothing, `extract` reads nothing, and a span costs a
function call. Set, each process exports over OTLP/HTTP from a background thread, and the
SDK's own `OTEL_*` variables — service name, headers, sampler — mean what the SDK says.

Three spans, named as OpenTelemetry's GenAI and MCP conventions name them:

- `invoke_agent {agent}` — one run, CLIENT kind: the agent is somebody else's server.
  `traceparent` goes to it on every round, as a header over HTTP and a key on the socket's
  run frame, so the agent's own spans join the trace.
- `execute_tool {tool}` — one of Blob's tools, run for an agent inside that run.
- `{method} {tool}` — one MCP request from somebody's assistant, SERVER kind, continuing
  the assistant's trace when `params._meta` carries one, as MCP's convention puts it.

A span carries ids, the names of agents and tools, counts and outcomes. Never what anybody
wrote, a tool's arguments or what it returned, and never an exception's message: a trace
leaves this server for a collector the operator chose, and a person's words should not
leave with it.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager, suppress
from typing import Any

from opentelemetry import propagate, trace
from opentelemetry.context import Context
from opentelemetry.trace import Span, SpanKind, Status, StatusCode

from ..config import served_commit, settings

log = logging.getLogger("blob.telemetry")

#: A proxy until `configure` installs a provider, then the real thing — so modules may take
#: it at import time.
_tracer = trace.get_tracer("blob")
_configured = False

#: The only keys read from a caller's trace context, and how long each may be. Baggage is
#: not taken from outside: nothing here would pass it on, and it is the caller's to send.
_CONTEXT_KEYS = ("traceparent", "tracestate")
_CONTEXT_MAX_CHARS = 512

__all__ = [
    "SpanKind",
    "active",
    "configure",
    "enabled",
    "extract",
    "fail",
    "inject",
    "shutdown",
    "span",
]


#: The two variables `config.Settings` declares, so that a `.env` file can set them.
_FROM_SETTINGS = ("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS")


def _setting(name: str) -> str:
    """A variable as the SDK will see it: the process environment first, then `.env`."""
    found = os.environ.get(name, "").strip()
    if not found and name in _FROM_SETTINGS:
        found = (getattr(settings, name, None) or "").strip()
    return found


def enabled() -> bool:
    """Whether this process has somewhere to send spans."""
    if os.environ.get("OTEL_SDK_DISABLED", "").strip().lower() == "true":
        return False
    return any(
        _setting(name)
        for name in ("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    )


def active() -> bool:
    """Whether spans are being recorded here — the SDK installed, not merely asked for. A
    span made while this is false is a function call and nothing more."""
    return _configured


def configure(process: str) -> bool:
    """Install the SDK for this process, once, if there is an endpoint. Never raises.

    `process` names it — `api` or `worker` — and is the service name unless
    `OTEL_SERVICE_NAME` says otherwise: runs are the worker's and MCP requests the API's,
    and a trace view that lists them apart is easier to read.
    """
    global _configured
    if _configured or not enabled():
        return False
    for name in _FROM_SETTINGS:
        # A value from `.env` reaches the SDK the only way it reads one.
        if not os.environ.get(name, "").strip() and _setting(name):
            os.environ[name] = _setting(name)
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        attributes: dict[str, str] = {"blob.process": process}
        if not os.environ.get("OTEL_SERVICE_NAME", "").strip():
            attributes["service.name"] = f"blob-{process}"
        commit = served_commit()
        if commit:
            attributes["service.version"] = commit
        provider = TracerProvider(resource=Resource.create(attributes))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)
    except Exception:
        # A collector that is misconfigured costs the traces, not the process.
        log.warning("could not start tracing; carrying on without it", exc_info=True)
        return False
    _configured = True
    log.info("tracing to the OTLP endpoint in the environment")
    return True


def shutdown() -> None:
    """Flush what is buffered. A no-op when tracing never started."""
    if not _configured:
        return
    provider = trace.get_tracer_provider()
    stop = getattr(provider, "shutdown", None)
    if callable(stop):
        with suppress(Exception):
            stop()


def _clean(attributes: Mapping[str, Any] | None) -> dict[str, Any]:
    """What a span may hold: OpenTelemetry refuses None, so absent means unset."""
    return {key: value for key, value in (attributes or {}).items() if value is not None}


@contextmanager
def span(
    name: str,
    *,
    kind: SpanKind = SpanKind.INTERNAL,
    attributes: Mapping[str, Any] | None = None,
    parent: Context | None = None,
) -> Iterator[Span]:
    """A span, current for the block. An exception is recorded by its class alone and
    re-raised: its message may quote what somebody wrote, and it is in the log anyway."""
    with _tracer.start_as_current_span(
        name,
        kind=kind,
        attributes=_clean(attributes),
        context=parent,
        record_exception=False,
        set_status_on_exception=False,
    ) as current:
        try:
            yield current
        except BaseException as error:
            fail(type(error).__name__, current)
            raise


def fail(error_type: str, target: Span | None = None) -> None:
    """Mark a span as having ended in error, as the conventions say: by `error.type`, with
    no description."""
    chosen = target if target is not None else trace.get_current_span()
    chosen.set_attribute("error.type", error_type)
    chosen.set_status(Status(StatusCode.ERROR))


def inject(carrier: dict[str, str]) -> dict[str, str]:
    """The current span's `traceparent` (and `tracestate`), written into `carrier`.

    Nothing at all while tracing is off — an agent is not sent a trace id for a trace that
    is going nowhere.
    """
    if _configured:
        propagate.inject(carrier)
    return carrier


def extract(*carriers: Mapping[str, Any] | None) -> Context | None:
    """The trace a request says it belongs to: the first carrier naming a valid one.

    Read only when tracing is on, and only `traceparent` and `tracestate`, only as strings
    of a sane length: these come from whoever sent the request, and OpenTelemetry's own
    parser raises on a value that is not a string.
    """
    if not _configured:
        return None
    for carrier in carriers:
        if carrier is None:
            continue
        given: dict[str, str] = {}
        for key in _CONTEXT_KEYS:
            value = carrier.get(key)
            if isinstance(value, str) and 0 < len(value) <= _CONTEXT_MAX_CHARS:
                given[key] = value
        if "traceparent" not in given:
            continue
        context = propagate.extract(given)
        if trace.get_current_span(context).get_span_context().is_valid:
            return context
    return None
