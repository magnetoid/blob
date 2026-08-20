# Blob

Blob is a smart, AI-powered, self-hosted group chat app.

A Slack-class team chat you run yourself: channels, DMs, threads, reactions, mentions,
full-history search, and live presence — with no message-history cap, no per-seat
pricing, and your data in your own Postgres.

The research behind the product and architecture decisions, plus the full roadmap,
lives in [TEAM-CHAT-BUILD-PLAN.md](TEAM-CHAT-BUILD-PLAN.md).

---

## What works today

- **Workspaces and accounts** — first signup founds the workspace; everyone else joins
  by invite link. Sessions are revocable server-side.
- **Channels** — public and private, archiving, topics, per-channel notification
  levels, join/leave, member management.
- **Direct messages** — one-to-one and named group DMs, deduplicated by member set.
- **Messages** — Markdown with code blocks, edit, delete, pin, optimistic send with
  idempotent retry, keyset-paginated history.
- **Threads** — Slack-style reply chains in a side panel, with live reply counts and
  participant facepiles on the root.
- **Reactions** — Unicode emoji, aggregated with who-reacted tooltips.
- **Mentions** — `@person`, `@channel`, `@here`, resolved at write time and never
  triggered from inside code blocks.
- **Attention** — unread cursors, mention badges, a "New messages" divider, keyword
  alerts, quiet hours, and Web Push when you're away.
- **Search** — Postgres full-text over the entire history with `from:`, `in:`,
  `has:link`, `has:file`, `before:` and `after:` modifiers, permission-filtered per user.
- **Presence** — live status dots and typing indicators. No read receipts, by design.
- **⌘K palette** — jump to any channel, person, or action.
- **Themes** — light, dark and system, each side filled by a named palette an admin can
  edit token by token, plus compact / comfortable / airy density.
- **Administration** — people and roles, invitations, every channel including private
  ones, an audit log, workspace settings, live health, and webhook management.
- **Incoming webhooks** — post into a channel from CI or a cron job.

Not built yet: file uploads (the API and schema are in place, the UI is not), huddles,
the plugin system, and the AI layer. See the plan's roadmap for the order.

## Stack

Python backend, React front end.

| Layer | Choice |
|---|---|
| Web | React 18 + Vite |
| API | FastAPI (Python 3.12), REST for writes |
| Data | SQLAlchemy 2.0 async + asyncpg, Alembic migrations |
| Realtime | FastAPI WebSockets, one event hub, Redis pub/sub between processes |
| Database | Postgres 16 — messages, search, everything |
| Ephemera | Redis — presence, typing, rate limits |
| Jobs | arq — notifications, link unfurls, sweeps |
| Files | S3-compatible (MinIO) with presigned uploads |

The chat queries are hand-tuned SQL held in `text()` rather than re-expressed as
query-builder chains; the ORM defines the schema, drives Alembic, and serves the
CRUD-heavy tables. The Alembic baseline runs the original SQL verbatim, so the schema is
byte-identical to the one the earlier TypeScript server left behind.

Message ids are UUIDv7, so they sort chronologically and "is this unread?" is a
comparison rather than a `COUNT`. Every write is idempotent on a client-generated id,
which is what makes optimistic UI and offline retries safe.

## Running it locally

Requires Node 22+, pnpm, Postgres 16 and Redis. (`docker compose up -d` starts
Postgres, Redis, MinIO and MailHog if you'd rather not install them.)

```bash
pnpm install                  # web + shared
cd apps/api && uv sync && cd ../..   # backend
cp .env.example .env          # then set SESSION_SECRET to `openssl rand -hex 32`

createdb blob                 # skip if you used docker compose
pnpm migrate                  # alembic upgrade head
pnpm seed                     # optional: a demo workspace with people and messages

pnpm dev                      # API on :3000, web on :5173
pnpm worker                   # in another shell: notifications and unfurls
```

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/) alongside Node and pnpm.

A database created by the earlier TypeScript server is adopted rather than rebuilt:
`alembic stamp 0001` then `alembic upgrade head`, after which the old
`schema_migrations` table can be dropped. Existing password hashes keep working —
argon2-cffi verifies what `@node-rs/argon2` wrote.

Open http://localhost:5173. The first account you create owns the workspace; invite
everyone else from Preferences.

The seeded demo workspace signs in with `ana@example.com` / `correct-horse-battery`.

## Layout

```
apps/api        FastAPI app, WebSocket tier, arq worker
apps/web        React client
packages/shared Types, zod schemas and the wire protocol used by the client
plugins/        local plugins (see the build plan)
```

`apps/api/src/blob_api/realtime/` imports nothing from `routers/`, so the socket tier can
move to its own process without a rewrite when connection counts justify it.

## Tests

```bash
pnpm check      # tsc + ruff + mypy + pytest
```

Integration tests run against a real Postgres (`blob_test`) and Redis, because the
behaviour worth testing — idempotent inserts, unread cursors, the permission join that
keeps private channels out of other people's search results — lives in SQL. The
WebSocket tests drive a real socket through the ASGI app.

## Licence

MIT.
