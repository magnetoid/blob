---
type: decision
status: accepted
tags: [adr, schema]
links: []
rules: []
---

# ADR 0002: UUIDv7 for every primary key

## Context
Unread state is the highest-traffic question in a chat app: "is there anything here I
have not seen?" Answered with a `COUNT(*)` per channel per user, it is the query that
takes the database down first.

## Decision
Every primary key is a UUIDv7 — time-ordered, so `ORDER BY id` is chronological.

## Consequences
Unread becomes a string comparison against a stored cursor, not a count and not a
timestamp join. Keyset pagination falls out of the same ordering. `is_newer(a, b)` in
`apps/api/src/blob_api/lib/ids.py` is the whole implementation.

Ids are carried as **strings**, not `uuid.UUID`: the ORM uses `as_uuid=False` and an
asyncpg type codec is registered on connect so hand-written `text()` queries return
strings too. Without that codec the two paths disagree and the comparisons silently stop
working.

This is the one schema decision that cannot be retrofitted cheaply.
