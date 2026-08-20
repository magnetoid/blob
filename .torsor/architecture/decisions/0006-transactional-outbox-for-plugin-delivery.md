---
type: decision
status: accepted
tags: [adr, plugins]
links: []
rules: []
---

# ADR 0006: A transactional outbox for plugin delivery

## Context
Firing an HTTP request to an app from the request handler gets both halves wrong: it can
deliver an event for a transaction that later rolls back, and it loses events whenever
the process restarts between COMMIT and the call.

## Decision
`plugin_events.emit()` writes `plugin_deliveries` rows **inside the caller's
transaction**. The worker drains the table separately.

## Consequences
A delivered event always corresponds to a committed row, and no event is lost to a badly
timed restart. Delivery is at-least-once, so apps deduplicate on `X-Blob-Delivery-Id`.

The drain **leases** rather than locks: it stamps `next_attempt_at` and commits before the
POST. Holding a transaction open across a call to someone else's server lets a slow app
keep a Postgres transaction alive for as long as it likes, which blocks vacuum and then
everything else. A crash mid-flight costs one attempt and the lease simply expires.

`SKIP LOCKED` makes two workers safe. Deliveries whose plugin is not enabled are not
leased at all, so disabling an app pauses its queue instead of burning its retries.

The queue is a latency optimisation; the table is the source of truth. A cron drain runs
every minute so a lost enqueue delays events rather than losing them.
