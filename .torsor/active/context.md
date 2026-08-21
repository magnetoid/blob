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

- ~~The Docker image build has never been run.~~ **Settled.** CI's `image` job builds it,
  boots `docker-compose.prod.yml` with `--wait`, checks `/healthz` and `/readyz`, and
  asserts the schema reached head — so the entrypoint's advisory-locked migration runs
  against a real Postgres on every push. Left here rather than deleted because the stale
  version of this note outlived the work and later got read back as fact: a full audit
  named the unbuilt image its largest deployment risk, on the strength of a line that had
  been untrue for weeks. A note that says a thing is unverified is itself a claim that
  expires.
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
- Coolify's **Docker Compose Location can silently revert to `/docker-compose.yml`**, the
  dev datastore stack, which has no `app` service — so the site 503s with every container
  gone and no obvious cause. Check that setting first when production is down; the value
  it needs is `/docker-compose.prod.yml`. Attaching a domain is a two-deploy dance for the
  same reason the README gives: Coolify refuses `docker_compose_domains` until it has
  parsed the compose file from git, and it only writes the proxy labels when it recreates
  the container.
- `torsor deps` reports every Python import as unknown here, `fastapi` and `sqlalchemy`
  included. It resolves its manifest from `--root`, and the repo root is a pnpm workspace:
  the Python manifest is at `apps/api/pyproject.toml`, one level down. So `torsor verify`
  fails its deps stage whenever a `.py` file changes, and passes when none has. The gate
  CI enforces is `torsor guard --strict --severity error`, which is unaffected — read a
  deps failure here as the layout, not as a hallucinated dependency.
- **`COOLIFY_URL` is Coolify's, not yours.** Coolify injects it into every container it
  runs, set to that container's *own* address, so a setting by that name can never hold
  the runner's API endpoint on the platform this feature exists to drive. The runner's
  base URL is `COOLIFY_API_URL` for exactly that reason, and a test asserts the old name
  is not read.
- **Do not connect this app to the runner's Docker network.** Coolify's own database is
  aliased `postgres` on the `coolify` network, and so is this stack's. Joining it makes
  `postgres` resolve to two addresses; DNS alternates, and roughly half of all connection
  attempts fail with `password authentication failed for user "blob"` — which reads like
  a credentials problem and is not one. Production went down this way. Reach the runner
  through `host.docker.internal` (mapped to `host-gateway` in the compose file) instead.
