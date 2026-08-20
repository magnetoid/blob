---
type: decision
status: accepted
tags: [adr, data]
links: []
rules:
  - kind: forbid_pattern
    target: "\\bOFFSET\\s+:"
    scope: "apps/api/src/blob_api/services/*.py"
    message: "Chat queries use keyset pagination, never OFFSET — see ADR 0003."
    severity: error
---

# ADR 0003: SQLAlchemy for schema, verbatim SQL for the hot paths

## Context
A design review argued for raw asyncpg over SQLAlchemy: the chat queries are hand-tuned
and asyncpg's `$1` placeholders are identical to node-pg's, so an ORM buys little on the
paths that matter. SQLAlchemy was chosen anyway, for Alembic and for the CRUD-heavy
tables. That counter-argument was substantive, so the mitigation is load-bearing rather
than optional.

## Decision
One data layer — SQLAlchemy 2.0 async — used two ways:

- **ORM models** define the schema, drive Alembic, and serve the CRUD tables (admin,
  themes, plugins) where an ORM genuinely helps.
- **Hot paths stay verbatim SQL** inside `text()` with `:named` params: the idempotent
  insert, the keyset history query, the `GREATEST` cursor advance, the search CTE.

## Consequences
The tuned queries are readable as SQL and testable as SQL. The Alembic baseline is
hand-written and runs the original `.sql` files verbatim, so the schema is byte-identical
to what the earlier TypeScript server left behind.

Models must spell out what autogenerate gets wrong — `Computed(..., persisted=True)` for
`search_tsv`, `postgresql_where=` for the partial indexes, `postgresql_using='gin'` —
or the first `--autogenerate` proposes dropping them. `alembic check` is the guard, and
it only works if every table has a model: `themes` was missed for two milestones and the
check failed silently until it was added.

Keyset pagination only, never OFFSET. Admin list endpoints may use OFFSET over small
tables; the chat paths may not.
