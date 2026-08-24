# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Blob — working notes for agents

Architectural memory lives in `.torsor/` and is the source of truth. This file is the
digest that loads every session; run the commands below when you need depth.

| Need | Command |
|---|---|
| Full project primer | `torsor primer` |
| Who calls this symbol | `torsor impact <symbol>` |
| Path between two symbols | `torsor connect <a> <b>` |
| Find a file or symbol | `torsor find <query>` |
| Check a change against intent | `torsor guard` |
| The whole gate | `torsor verify` |

Read before changing the equivalent code: the traps list in
`.torsor/active/context.md`. It records the failures this codebase has already sprung —
FastAPI's 422 vs the client's 400, `isoformat()` precision, the partial display-name
index, the asyncpg uuid codec, AG-UI's SCREAMING_SNAKE wire values, and the Coolify and
firewall mistakes that took production down. `.torsor/architecture/decisions/` holds the
eleven ADRs; the principles below are their summary, not a substitute.

## Commands

The repo is a pnpm workspace that also drives the Python backend: `apps/api/package.json`
is a shim whose scripts shell out to `uv run`. Root scripts are the normal entry point.

| Task | Command |
|---|---|
| The gate — tsc + eslint + ruff + mypy --strict + pytest | `pnpm check` |
| Dev servers — API on :3000, web on :5173 | `pnpm dev` |
| Job worker (notifications, unfurls, plugin delivery) | `pnpm worker` |
| Migrate — advisory-locked, same path the container entrypoint takes | `pnpm migrate` |
| Seed a demo workspace | `pnpm seed` |
| Regenerate `packages/shared/openapi.json` | `pnpm openapi` |

Backend, from `apps/api/`:

```bash
uv run pytest -q                                   # 374 tests; needs Postgres + Redis
uv run pytest tests/test_messages.py -q            # one file
uv run pytest tests/test_messages.py::test_sending_is_idempotent_for_a_repeated_client_msg_id -q
uv run pytest -q -k "unread or mention"            # by name
uv run mypy src                                    # strict
uv run ruff check src tests                        # ruff format src tests to fix
uv run alembic check                               # drift: models vs live schema, must stay quiet
uv run alembic upgrade head
```

Frontend, from `apps/web/`:

```bash
pnpm exec vitest run src/lib/outbox.test.ts        # one file
pnpm exec vitest run -t "stores and reloads queued entries"   # by name
pnpm typecheck                                     # tsc --noEmit
pnpm lint                                          # eslint
```

Tests need a real Postgres (`blob_test`) and Redis (db 15) on localhost —
`docker compose up -d` starts Postgres, Redis, MinIO and MailHog. The attachment and
feedback-snapshot tests **skip** without MinIO, which is green while proving nothing, so
bring storage up before trusting a clean run of those. `conftest.py` migrates once per
session and `TRUNCATE`s before each module; the event loop is session-scoped because the
engine and Redis clients are bound to the loop that created them.

## Architecture

Two tiers, three processes: the FastAPI app (HTTP + WebSocket), the arq worker, and the
React client. In production all of it is one image on one origin — `web.py` mounts the
built client last, so every real route wins first and unknown paths under `/api` and
`/ws` get a 404 rather than index.html.

**The write path.** `routers/` shape and authorize; `services/` hold the logic and the
hand-written SQL; `db/engine.transaction()` yields `(session, after)` and drains
`after`'s callbacks *past* COMMIT. That is persist-then-broadcast made structural rather
than remembered — see `services/messages.py:send` for the canonical ordering. Routers may
import services; nothing imports routers back.

**The read path for live updates.** `realtime/hub.py` fans out by user and by channel to
local sockets and publishes to Redis, where sibling processes re-broadcast to theirs — a
second container needs no code change. The socket only *delivers*: every write is REST,
so an outage costs live updates and never data. `socket.ts` reconnects with backoff and
asks the server what it missed instead of assuming the gap was empty.

**The wire contract.** `packages/shared/` is the client's view of the server — types, zod
schemas, and `protocol.ts`. `protocol.ts` and `realtime/protocol.py` are hand-written
twins because the socket carries a discriminated union that OpenAPI would not describe;
`tests/test_protocol_parity.py` parses the TypeScript and compares, because the drift is
otherwise silent (rename an event and the client just ignores a frame forever).

**Auth.** `SessionMiddleware` in `main.py` is pure ASGI — `BaseHTTPMiddleware` interferes
with streaming and background tasks — and resolves the cookie once per request against an
allowlist (`PUBLIC_ROUTES`, `PUBLIC_PREFIXES`). `/api/v1/` is the app callback API: it
bypasses the cookie check because it authenticates with a bot token, and enforces that
itself on every route via `current_bot`.

**Errors are a contract.** The codes in `lib/errors.py` are what `apps/web/src/lib/api.ts`
branches on. Don't rename them, and keep FastAPI's 422 remapped to 400 `invalid_input`.

**Schema.** `db/models.py` defines it and drives Alembic; migrations live in
`db/migrations/versions/` with `0001_baseline` running the original TypeScript server's
SQL verbatim, so an existing database is adopted rather than rebuilt. `alembic check`
runs in CI — if the models drift, the next autogenerate proposes dropping the generated
column and the partial indexes.

**Apps and agents.** `plugins/` is the integration layer: a manifest and scope catalogue,
SSRF-guarded registration, a bot that is a real `users` row (so `author_id` stays a valid
FK and mentions, search and DMs work with no frontend change), HMAC-signed delivery
through a transactional outbox that the worker drains one request at a time per plugin.
`plugins/agui.py` is a pure bytes-in/writes-out function — Blob is the AG-UI *client* and
the agent is the server, which is the direction every agent framework already ships.

The one exception is `runtime: "socket"` (`plugins/gateway.py`, ADR 0012), for an agent
with no address at all — on a laptop, behind NAT. It dials Blob and holds a WebSocket, and
runs go down that pipe. Only the *transport* reverses: the agent still answers runs it did
not start, and the same `Fold` reads the same events. The part that bites is that the
process holding the socket is not the process running the job — mentions are the worker's,
sockets are an API process's — so every run crosses through Redis, which is why the holder
claims a run id with `SET NX` and why `stream_events` subscribes before it publishes.

**Client.** `features/` by domain, `lib/` for the plumbing: a zustand store keeping
messages per channel in ascending id order (UUIDv7 sorts chronologically, so a live
insert is a sorted-position insert and "unread?" is a string comparison — the same trick
the server uses), a typed `api.ts`, a localStorage outbox for offline replay, and a
hand-rolled `router.ts` because there are no nested layouts or loaders to justify more.

### Non-negotiable principles
- **Open source, and agent-native.** Blob is an open-source AI agentic work-team
  communication platform. Every feature ships in this repo under one licence, with nothing
  held back behind a plan check or an enterprise tier — the deployment a team runs is the
  whole product. Agents join a workspace as real members with real permissions, and their
  output lands in the conversation rather than in a panel bolted beside it.
- **As familiar as Slack.** Someone who uses Slack should not have to learn Blob: the same
  layout, the same words for things — channels, threads, DMs, reactions, ⌘K — and the same
  keyboard reflexes. Where a cleverer interaction competes with the one Slack users already
  have in their fingers, ship Slack's. The only exceptions are the other principles on this
  list, and each one is a deliberate departure rather than a difference for its own sake.
- **The client is the contract.** The React app is the acceptance test for the server. If
  an unmodified client breaks, the server is wrong — this is what carried the TypeScript →
  Python rewrite without a single frontend change.
- **Persist, then broadcast.** No event is ever emitted from inside a transaction. A
  client must never be told about a row that has not committed.
- **Hand-tuned SQL stays SQL.** The chat queries are tuned and tested; they live in
  `text()` verbatim rather than being re-expressed as query-builder chains.
- **Ids are UUIDv7.** Chronological sort order is load-bearing: unread state is a string
  comparison, not a count or a timestamp join. This is the one schema decision that
  cannot be retrofitted cheaply.
- **Every write is idempotent on a client-supplied id.** That is what makes optimistic UI
  and offline retry safe rather than duplicating messages.
- **Privacy is a feature, not a gap.** No read receipts. No presence or typing events for
  apps. Private channels answer 404, not 403, because their existence is private.
- **Fail toward the workspace staying up.** A dead mail server, a broken plugin, a slow
  app or a failed unfurl degrades that one thing and nothing else.

### Architecture rules (machine-enforced — `torsor guard` flags violations)
- forbid_pattern: `\bOFFSET\s+:` in `apps/api/src/blob_api/services/*.py` — Chat queries use keyset pagination, never OFFSET — see ADR 0003. (per ADR 0003: SQLAlchemy for schema, verbatim SQL for the hot paths)
- forbid_layer_import: `blob_api\.routers(\.|$)` in `apps/api/src/blob_api/realtime/*.py` — realtime/ must not import routers/ — the socket tier moves out as a unit. ADR 0004. (per ADR 0004: Persist, then broadcast — structurally)
- forbid_layer_import: `blob_api\.routers(\.|$)` in `apps/api/src/blob_api/plugins/*.py` — plugins/ must not import routers/ — routers depend on the plugin layer, not the reverse. ADR 0005. (per ADR 0005: A plugin's bot is a real user row)

`torsor verify`'s deps stage fails on any `.py` change here — it resolves its manifest
from `--root` and the Python one is a level down at `apps/api/pyproject.toml`. Read that
as the workspace layout, not a real finding. The gate CI enforces is
`torsor guard --strict --severity error`, which is unaffected.
