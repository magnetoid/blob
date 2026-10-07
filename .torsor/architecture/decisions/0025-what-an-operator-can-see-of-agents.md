---
type: decision
status: accepted
tags: [adr, agents, observability, privacy, operations]
links:
  [
    0011-agui-is-an-inbound-transport,
    0016-an-assistant-token-is-a-person,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
  ]
rules: []
---

# ADR 0025: What an operator can see of agents — traces, counters, a run's events, an app's errors

## Context

The 2026-10-05 review found nothing to observe agents with: no metrics, no traces, no
record of what an agent actually streamed, and `plugins.last_error` was one string the
next failure overwrote. The run log (migration 0016) and the card (migration 0019) say what a
run did and how it ended, for the room. They do not say why, and an operator asking why an
agent was slow, or failed three different ways in an hour, had only the server's log.

Three facts constrain any answer. Runs happen in the worker and MCP calls in whichever API
process took the request, so no one process sees everything. A self-hosted Blob usually
has no collector, and must cost nothing and send nothing when it has none. And what a run
carries is the room's own words: a trace leaves the server for a collector somebody else
may run, and a run's events are as private as the room they came from.

## Decision

**Four things, each off or bounded until an operator asks for it.**

- **Traces, through OpenTelemetry, only when an OTLP endpoint is named**
  (`OTEL_EXPORTER_OTLP_ENDPOINT`, `lib/telemetry.py`). Unset, the SDK is never installed:
  spans are non-recording, no trace id is written to any request and none is read from
  one. Set, each process exports over OTLP/HTTP. Spans follow OpenTelemetry's GenAI and
  MCP conventions: `invoke_agent {agent}` for a run (CLIENT; its `traceparent` goes to the
  agent as a header on every round, and on the socket's run frame), `execute_tool {tool}`
  for one of Blob's tools run for an agent, and `{method} {tool}` for an MCP request
  (SERVER; a child of the assistant's trace when `params._meta` carries `traceparent`, as
  the MCP conventions put it). **A span carries ids, names of agents and tools, counts and
  outcomes — never message text, a tool's arguments or results, or an exception's
  message.** A failure is recorded by `error.type`, a status or a class name.
- **Counters, shared through Redis, scraped at `/metrics`** (`lib/metrics.py`). Runs by
  agent and how they ended, run duration as a histogram, tokens by kind, and Blob's tools
  by who called them (an agent or an assistant) and how it went (`ok`, `refused`,
  `failed`, `asked`, `declined`, `not_run`). One Redis hash, so every process counts into
  the same numbers and a scrape of any process reads them all; counters only go up, so a
  Redis that restarts empty is a counter reset, which Prometheus expects. Two gauges — runs
  in flight, decisions waiting — are read from the database at scrape time. The route
  answers only a bearer `METRICS_TOKEN` and is a 404 while that is unset: the numbers name
  every agent on the server. A count is written after what it counts commits, under a
  short timeout, and never raises.
- **A run keeps what it streamed, for a week** (`agent_runs.events`, `plugins/run_trail.py`):
  the newest 200 AG-UI events, each cut to a few hundred characters per string, a file's
  pieces reduced to their size, and reasoning stripped of its words unless the agent's
  row shows reasoning — the card's rule, so the log is no way round it. Written when the
  run ends, including a run that broke inside Blob, and emptied by the nightly sweep after
  seven days while the run stays for its thirty. An admin reads it under the run in the
  console **only where they can see the room**, the rule a run's card already follows;
  elsewhere the answer says it is hidden and carries nothing.
- **An app keeps its last ten errors** (`plugins.recent_errors`), newest first, with their
  times. `last_error` stays as the app's present state; switching the app back on clears
  it and leaves the history.

## Consequences

- Three runtime dependencies: `opentelemetry-api`, `-sdk` and `-exporter-otlp-proto-http`
  (which brings `protobuf` and `requests`). The exporter runs on the SDK's own thread.
- Migration 0052 adds `agent_runs.events`, `plugins.recent_errors` (backfilled from
  `last_error`) and a partial index on running runs for the in-flight gauge.
- A third-party agent now receives a `traceparent` header when the operator traces. It is
  not covered by the request signature, and does not need to be: it names a trace, not an
  instruction. The socket guide documents the frame keys; `tools/agent_bridge.py` forwards
  them to the local agent as headers.
- Not done: OpenTelemetry metrics over OTLP (the counters are the scrape's), HTTP server
  spans for every route, and propagating a trace from the message that started a run into
  the worker's run span — the run span is a root today.
