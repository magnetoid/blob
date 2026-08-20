---
type: decision
status: accepted
tags: [adr, realtime]
links: []
rules:
  - kind: forbid_layer_import
    target: "blob_api\\.routers(\\.|$)"
    scope: "apps/api/src/blob_api/realtime/*.py"
    message: "realtime/ must not import routers/ — the socket tier moves out as a unit. ADR 0004."
    severity: error
---

# ADR 0004: Persist, then broadcast — structurally

## Context
The classic realtime bug: an event is emitted from inside a transaction, a client reacts
by fetching the row, and the row is not committed yet. It is intermittent, load-dependent,
and invisible in tests that run one request at a time.

## Decision
`transaction()` yields `(session, after)` where `after` is an `AfterCommit` collector.
Side effects registered on it are drained past `COMMIT`. Routers register; services do
not emit.

## Consequences
Correct ordering is the path of least resistance rather than something to remember. The
same seam later became the natural place to write plugin outbox rows — inside the
transaction — with delivery triggered after it.

`realtime/` imports nothing from `routers/`, so the socket tier can be lifted into its own
process when connection counts justify it. This is enforced, not just documented.

The hub's `send()` is `put_nowait` onto a bounded per-connection queue with a writer task;
a full queue closes the connection. A slow consumer costs one socket, not the process.
