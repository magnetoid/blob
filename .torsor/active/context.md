---
type: active-context
status: active
tags: [active]
---

# Active Context

## Current focus

Milestone 16 (external apps) shipped and now has a working admin Apps console. The
agentic workspace slice is also in place: thread summaries, human/agent tasks, durable
offline outbox replay, and multilingual message translation are all implemented. The next
large roadmap seam is still **milestone 17: blocks** — `messages.blocks jsonb` already
exists, unrendered; what is missing is the seven block types, `BlockRenderer.tsx`, and
`/api/interactions` verifying that an `actionId` exists in the *stored* blocks.

## Recent changes

- **Milestone 16** — external apps end to end: manifest and scope catalogue,
  SSRF-guarded registration, bots as real users, scoped `/api/v1/` callback API,
  HMAC-signed delivery through a transactional outbox with leased draining.
- **Deployment** — one image serving client and API on one origin,
  `docker-compose.prod.yml` for Coolify, migrations on boot under an advisory lock.
- **Milestones 14–15** — theme system: four presets, admin editor with live preview,
  no-flash boot script.
- **Milestones 11–13** — superadmin console: people, invitations, channels, audit log,
  settings, health, webhooks.
- **Milestones 1–10** — the TypeScript server was rewritten in Python and deleted. The
  React client ran against the new backend unmodified.

## Open questions

- **The Docker image build has never been run.** Local disk was too full to start a
  Docker daemon, so the Dockerfile and compose file are verified only by reading, by a
  local run of the production serving path, and by pinning the two toolchain versions
  whose defaults would have failed the build (uv 0.11 for lockfile revision 3, corepack's
  download prompt).
- **The plugin console frontend now exists.** Administration → Apps covers install,
  approval, enable/disable, token and secret rotation, uninstall, and delivery-log
  inspection.
- **`fastembed` is not installed**, so torsor recall falls back to hashing embeddings.

## Traps this codebase has already sprung

Worth knowing before changing the equivalent code:

- FastAPI returns **422** for validation; this client expects **400 `invalid_input`**.
- Python's `isoformat()` emits microseconds and `+00:00`; the client expects milliseconds
  and `Z`.
- `Request(scope)` asserts an http scope and 500s on a WebSocket upgrade — use
  `HTTPConnection`.
- Raw `text()` queries return `uuid.UUID` unless the asyncpg codec is registered.
- `users_display_name_uniq` is **partial** (`WHERE deactivated_at IS NULL`), so
  reactivating or naming a bot after an existing person needs a clash check first.
- Alembic's `fileConfig` sets the root logger to WARNING as a side effect and, without
  `disable_existing_loggers=False`, silences every logger configured before it.
