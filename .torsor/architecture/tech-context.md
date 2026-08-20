---
type: tech-context
status: active
tags: [architecture]
---

# Tech Context

## Stack & versions

| Layer | Choice |
|---|---|
| API | FastAPI on Python 3.12, `uv` for dependencies |
| Data | SQLAlchemy 2.0 async + asyncpg, Alembic migrations |
| Database | Postgres 16 — messages, full-text search, everything durable |
| Ephemera | Redis — presence, typing, rate limits, the arq job queue |
| Jobs | arq — notifications, link unfurls, plugin delivery, sweeps |
| Realtime | FastAPI WebSockets, one hub per process, Redis pub/sub between them |
| Web | React 18 + Vite, zustand, no router (rail views are `useState`) |
| Files | S3-compatible (MinIO in dev) with presigned uploads |
| Tooling | ruff, mypy --strict, pytest + pytest-asyncio, pnpm workspace |

## Constraints

- **Under 100 users, one workspace.** Every scaling decision is allowed to assume this.
  Ordering beats throughput; a single Postgres is the right answer.
- **Postgres does the work.** Full-text search is Postgres FTS, not a separate engine.
  Adding a search cluster is a decision to be argued for, not a default.
- **mypy --strict and ruff must stay clean.** They are part of `pnpm check`, which is the
  gate.
- **Integration tests run against real Postgres and Redis** (`blob_test`, Redis db 15).
  The behaviour worth testing — idempotent inserts, unread math, the permission join —
  lives in SQL, and a mock of Postgres only proves the mock works.
- **The wire format is camelCase**, produced by Pydantic's `alias_generator=to_camel`.
  Timestamps are millisecond-precision ISO strings ending in `Z`.
- **Validation errors are 400 `invalid_input`**, never FastAPI's default 422 — the client
  branches on it.

## Environments

Development runs Postgres and Redis on the host (`docker compose up -d` also works).
Production is one image serving the client and API on a single origin; see
[[0008-one-image-one-origin]].
