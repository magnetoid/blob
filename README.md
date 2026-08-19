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
- **Themes** — light, dark, and system, plus compact / comfortable / airy density.
- **Incoming webhooks** — post into a channel from CI or a cron job.

Not built yet: file uploads (the API and schema are in place, the UI is not), huddles,
workflow automation, and the AI layer. See the plan's roadmap for the order.

## Stack

TypeScript end to end.

| Layer | Choice |
|---|---|
| Web | React 18 + Vite |
| API | Fastify (Node 22+), REST for writes |
| Realtime | `ws`, one event bus, Redis pub/sub between processes |
| Database | Postgres 16 — messages, search, everything |
| Ephemera | Redis — presence, typing, rate limits |
| Jobs | BullMQ — notifications, link unfurls |
| Files | S3-compatible (MinIO) with presigned uploads |

Message ids are UUIDv7, so they sort chronologically and "is this unread?" is a
comparison rather than a `COUNT`. Every write is idempotent on a client-generated id,
which is what makes optimistic UI and offline retries safe.

## Running it locally

Requires Node 22+, pnpm, Postgres 16 and Redis. (`docker compose up -d` starts
Postgres, Redis, MinIO and MailHog if you'd rather not install them.)

```bash
pnpm install
cp .env.example .env          # then set SESSION_SECRET to `openssl rand -hex 32`

createdb blob                 # skip if you used docker compose
pnpm migrate
pnpm seed                     # optional: a demo workspace with people and messages

pnpm dev                      # API on :3000, web on :5173
```

Open http://localhost:5173. The first account you create owns the workspace; invite
everyone else from Preferences.

The seeded demo workspace signs in with `ana@example.com` / `correct-horse-battery`.

## Layout

```
apps/server     Fastify API, WebSocket tier, background worker
apps/web        React client
packages/shared Types, zod schemas and the wire protocol, shared by both
```

`apps/server/src/realtime/` imports nothing from `routes/`, so the socket tier can move
to its own process without a rewrite when connection counts justify it.

## Tests

```bash
pnpm check      # typecheck + lint + tests
```

Integration tests run against a real Postgres (`blob_test`) and Redis, because the
behaviour worth testing — idempotent inserts, unread cursors, the permission join that
keeps private channels out of other people's search results — lives in SQL.

## Licence

MIT.
