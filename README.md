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
- **Apps** — external integrations with a name, an avatar and a place in the member list.
  Signed event delivery, a scoped callback API, and a bot that is a real user. See
  [docs/apps.md](docs/apps.md).

- **Files** — attach by button, drag-and-drop, or pasting a screenshot straight into the
  composer. Uploads go to object storage directly, so file bytes never pass through the
  API process.

Not built yet: huddles, message blocks, the local plugin runtime, slash commands, and the
AI layer. See the plan's roadmap for the order.

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

## Deploying it

The client and the server ship as one image on one origin: `/`, `/api` and `/ws` all come
from the same host, so the session cookie needs no CORS exemption and a proxy in front has
a single service to route.

### Coolify

New resource → **Docker Compose** → set *Docker Compose Location* to
`/docker-compose.prod.yml` → deploy.

The first deploy generates the domain, the database password and the session secret and
holds them for every deploy after, so a working workspace needs nothing typed in. The
first account you create at the generated URL owns it.

Worth setting once it is up:

| Variable | Why |
|---|---|
| `PUBLIC_URL` | **Set this explicitly to the full public origin, scheme included.** Coolify's generated `SERVICE_FQDN_APP` can arrive as a bare host, and a schemeless value parses to an empty host — which fails the origin check on every mutating request, so sign-in returns "Blocked request." and nothing else explains why. |
| `SMTP_HOST` and friends | Invitations and password resets arrive by mail. Without them invite links still work — they are shown in the UI — but a forgotten password needs an admin. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push when someone is away. `npx web-push generate-vapid-keys`. Without them, notifications stay in-app. |

Coolify sets a compose service's domain from `docker_compose_domains`, which it refuses
to accept until it has parsed the compose file from git — so the first deploy has to run
before the domain can be attached, and a second one applies it.

Two things to know about the stack it builds:

- **Backups are yours to arrange.** Coolify's automated backups cover databases it manages
  as resources, not ones inside a compose file. If you want them, create a Postgres
  resource in Coolify, point `DATABASE_URL` at it, and delete the `postgres` service here.
  The same applies to Redis, though Redis holds only the job queue and presence.
- **MinIO needs its own hostname.** The browser uploads to the bucket directly and reads
  from it directly, and a presigned URL is signed for one specific host — so MinIO gets a
  domain of its own (`SERVICE_FQDN_MINIO_9000`) and the app signs with it. If those two
  disagree, every attachment link resolves to a host the browser cannot reach. Set
  `S3_PUBLIC_ENDPOINT` to that domain explicitly, **scheme included**: Coolify's
  `SERVICE_FQDN_*` is a bare hostname by design — only `SERVICE_URL_*` carries a scheme —
  and boto3 signs against a URL. Point `S3_*` at a managed S3 instead and the service can
  be deleted outright.
- **A reverse proxy in front needs `client_max_body_size` raised** to at least the upload
  cap, and `proxy_request_buffering off` so a large upload streams through rather than
  spooling to the proxy's disk first. nginx defaults to 1 MB, which rejects most real
  attachments with a 413 the client cannot explain.

### Anywhere else

`docker compose -f docker-compose.prod.yml up` works with the four `SERVICE_*` values
supplied yourself. For a plain `docker build`, the root `Dockerfile` builds the whole app
from the repo root and takes its datastores from `DATABASE_URL` and `REDIS_URL`.

Behind any reverse proxy, two settings matter:

- `PUBLIC_URL` must be exactly the public origin. Every mutating request is checked
  against it, and a mismatch shows up as "Blocked request." on sign-in.
- Keep `--proxy-headers` on uvicorn (the image's default). Without it every request appears
  to come from the proxy, so one person failing logins rate-limits everybody and every
  audit row records the same address.

Migrations run from the entrypoint on each boot, under a Postgres advisory lock — replicas
booting together serialize rather than race, and a failed migration stops the container
instead of serving against a schema it does not have.

`/healthz` is liveness and touches nothing; `/readyz` checks Postgres and Redis. The
container health check uses the first deliberately, so a database blip does not restart a
healthy app.

## Layout

```
apps/api        FastAPI app, WebSocket tier, arq worker
apps/web        React client
packages/shared Types, zod schemas and the wire protocol used by the client
plugins/        local plugins (see the build plan)
docs/           what people integrating with Blob need
Dockerfile      builds both tiers into one image; context is the repo root
docker/         container entrypoint
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
