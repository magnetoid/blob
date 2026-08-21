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

Recorded commands — `torsor commands --run <name>`:

| Name | Command |
|---|---|
| `check` | `pnpm check` — tsc + ruff + mypy --strict + the full pytest suite |
| `test` | backend tests (needs Postgres `blob_test` and Redis) |
| `dev` | API on :3000, web on :5173 (`pnpm worker` for jobs) |
| `migrate` | advisory-locked alembic upgrade |
| `drift` | `alembic check` — must stay quiet |

Read before changing the equivalent code: the traps list in
`.torsor/active/context.md`. It records the failures this codebase has already sprung —
FastAPI's 422 vs the client's 400, `isoformat()` precision, the partial display-name
index, and the asyncpg uuid codec.


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
