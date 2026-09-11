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
sixteen ADRs; the principles below are their summary, not a substitute. 0013–0016 are the
agentic surface — chains, work channels, summaries and nudges, the MCP caller — and are
the ones this digest compresses hardest, so read them before changing that code.

`docs/` carries the three integrator guides (`apps.md`, `agent-socket.md`,
`agent-terminal.md`) alongside planning history; the guides are current, the rest is not.

## Commands

The repo is a pnpm workspace that also drives the Python backend: `apps/api/package.json`
is a shim whose scripts shell out to `uv run`. Root scripts are the normal entry point.

| Task | Command |
|---|---|
| First time — install both toolchains | `pnpm install && (cd apps/api && uv sync)` |
| The gate — tsc + eslint + ruff + mypy --strict + vitest + pytest | `pnpm check` |
| Build the client and the shared package | `pnpm build` |
| Dev servers — API on :3000, web on :5173 | `pnpm dev` |
| Job worker (notifications, unfurls, plugin delivery) | `pnpm worker` |
| Migrate — advisory-locked, same path the container entrypoint takes | `pnpm migrate` |
| Seed a demo workspace | `pnpm seed` |
| Regenerate `packages/shared/openapi.json` | `pnpm openapi` |
| Refresh the history "What's new" shows | `pnpm stamp` (before a release commit) |

`pnpm check` is `typecheck && lint && test` fanned out over the workspace, so the Python
half rides in through `apps/api/package.json`'s shim. Two things it does **not** run:
`alembic check` and `torsor guard`. CI runs both as separate steps, so a green `pnpm check`
is not a green CI.

Backend, from `apps/api/`:

```bash
uv run pytest -q                                   # 1374 tests; needs Postgres + Redis
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
pnpm exec vitest run                               # 75 files, happy-dom, no browser needed
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

**A merge to `main` ships to production.** `.github/workflows/ci.yml` runs three jobs —
`check` (the gate plus `alembic check`), `image` (build the Dockerfile, boot
`docker-compose.prod.yml`, hit `/healthz` and `/readyz`), and `intent`
(`torsor guard --strict --severity error` over `git ls-files '*.py'`). On a green push to
`main` a fourth job POSTs the Coolify deploy hook. It is `needs:`-gated rather than a
repository webhook on purpose: a webhook would deploy a red build as eagerly as a green
one. Treat a merge to `main` as a deploy, and remember the 2026-09-05 rule — one Coolify
build at a time.

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
allowlist (`PUBLIC_ROUTES`, `PUBLIC_PREFIXES`). There are three kinds of caller, not two.
A person carries a session cookie. `/api/v1/` is the app callback API: it bypasses the
cookie check because it authenticates with a bot token, and enforces that itself on every
route via `current_bot`. `/api/mcp` is the third (ADR 0016) — somebody's assistant reaching
in, holding an `mcp_tokens` row that resolves to a *user*, not a bot, because an assistant
acting for a person should have exactly that person's reach and show up in the audit log as
them. It is listed in `PUBLIC_ROUTES` as three exact `(method, path)` pairs and **not** as
a prefix: `PUBLIC_PREFIXES` is a `startswith` test, and `/api/mcp` as a prefix would also
open the routes next door that mint credentials.

**Errors are a contract.** The codes in `lib/errors.py` are what `apps/web/src/lib/api.ts`
branches on. Don't rename them, and keep FastAPI's 422 remapped to 400 `invalid_input`.

**Schema.** `db/models.py` defines it and drives Alembic; migrations live in
`db/migrations/versions/` with `0001_baseline` running the original TypeScript server's
SQL verbatim, so an existing database is adopted rather than rebuilt. `alembic check`
runs in CI — if the models drift, the next autogenerate proposes dropping the generated
column and the partial indexes.

The chain is sequential, `0001` … `0035`, so the highest number is the head. That is a
convention the files keep, not one Alembic enforces: `alembic revision` names a migration
by hash, and one arrived that way, chained from `0031` while main had reached `0034`. Two
heads, and `alembic upgrade head` refuses to pick a side — which does not fail one test, it
fails **every** test at setup, because `conftest.py` migrates before it does anything else.
A wall of errors with no assertion in it is this until proven otherwise. Ask
`uv run alembic heads` before writing a `down_revision`, and rename a generated migration
into the sequence while it is still unapplied, because the revision id is what a deployed
database has recorded and renaming it later strands that database.

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

**What sits on top of the plugin layer.** `plugins/` is the transport; these five are the
product built on it. The first three relax a rule an earlier ADR set, so the ADR is the
place to look before changing them.

* **Chains** (`services/agent_chains.py`, ADR 0013). "Only a person's message starts a
  run" was the loop guard, and it was structural rather than a counter. A chain replaces
  it: a person roots one, an agent's reply may extend it by one hop, a person's answer
  resumes a run that stopped to ask. The authority that flows down the chain is the
  rooting person's, which is why an agent only its owner may command cannot be reached
  through somebody else's hop.
* **Work channels** (`services/work.py`, `features/work/`, ADR 0014). An ordinary private
  channel with a `work_items` row attached — no fifth channel kind — so threads, mentions,
  Stop, `/allow`, archiving and search all work unchanged, and the row is only what makes
  the client draw the tabs. Artifacts are **data**: a diff is coloured text, a document is
  markdown through the message renderer, a page runs in a sandboxed frame and only after a
  person asks for it. Blob executes nothing an agent publishes (ADR 0007).
* **The agent Blob runs itself** (`plugins/builtin.py`, `services/workspace_agent.py`,
  `lib/llm.py`). Seeded into every workspace through the ordinary install path with
  `trusted=True`, so it is a `plugins` row with a bot in `users` and an admin revokes it
  with the same two clicks as anything else. `lib/llm.py` is deliberately the smallest
  possible provider layer with three callers — the built-in agent, the unread recap, and
  thread summaries. Do not grow it into a framework.
* **Summaries and nudges** (`services/agentic.py`, `services/unanswered.py`, ADR 0015).
  `thread_summaries.provider` records *which* engine wrote a row: `heuristic-v1` for the
  keyword scan that runs when no model is configured, `llm:<model>` otherwise. Both
  production instances run with no model, so every path has to be honest in that state.
  Nudges go to the asker alone — see the privacy principle below.
* **The agent terminal** (`routers/agent_shell.py`, `lib/agentTerminal.ts`). A third
  WebSocket endpoint beside `realtime/ws.py` and `plugins/gateway.py`, pumping bytes
  between a PTY and xterm.js. It authenticates with the ordinary session cookie —
  `SessionMiddleware` resolves those for websocket scopes too — because minting a
  credential for it would mean a long-lived secret that opens a root shell.
  `services/agent_shell.py` decides who may open one; the router decides nothing.

**Meetups** (`services/meetups.py`, `features/meetups/`) sit apart from all of that and are
the newest and least settled thing here. Blob mints a LiveKit token; LiveKit carries the
media. Three things to know before touching it: it is the one service written against the
ORM rather than `text()`, it has **no tests at all**, and it is the only feature with an
external dependency that can be absent — with no `LIVEKIT_*` settings every endpoint
answers `livekit_not_configured` and nothing else in the workspace notices, which is the
"fail toward the workspace staying up" rule holding. `docker compose up -d` runs a LiveKit
in dev on 7880 with LiveKit's own placeholder credentials. In production the signalling
WebSocket goes through Traefik like anything else, but the media is UDP and a reverse proxy
only carries TCP, so 7882/udp is published straight onto the host and has to be open in the
firewall — miss it and a call connects, shows both participants and carries no sound.

**Client.** `features/` by domain, `lib/` for the plumbing: a zustand store keeping
messages per channel in ascending id order (UUIDv7 sorts chronologically, so a live
insert is a sorted-position insert and "unread?" is a string comparison — the same trick
the server uses), a typed `api.ts`, a localStorage outbox for offline replay, and a
hand-rolled `router.ts` because there are no nested layouts or loaders to justify more.

**The design layer.** `styles/tokens.css` is the whole vocabulary and `styles/app.css`
spends it: colour, type and layout, plus elevation (`--elev-1..3`), radius
(`--radius-xs..full`), motion (`--dur-*`, `--ease-*`, `--motion-*`) and a stacking ladder
(`--z-raised` … `--z-toast`). Three rules the file will not tell you on its own:

* **The 44 colour names are a contract with the server.** `services/themes.py` allowlists
  them by string and slices that tuple *by index* to group the theme editor, so renaming
  or reordering one breaks stored themes and the editor's grouping at once. Everything
  else in tokens.css is structure and is free. A themed *value* can only be hex or
  `rgb()` — the grammar refuses `color-mix()` and `oklch()`, though app.css may use them.
* **Elevation carries its own border.** Every `--elev-*` opens with a `0 0 0 1px` ring, so
  an elevated surface sets `box-shadow` and no `border`. Setting both is how four
  different popover treatments drifted apart before.
* **Overlays enter; only menus leave.** `Menu` holds its panel through the exit with
  `lib/usePresence.ts`; the dialogs are `{open && <X/>}` in their parents and run a focus
  trap, an autofocus and (CatchUpPanel) a request on mount, so rendering them always —
  which is what an exit animation needs — would fire all of that at start-up.

Reduced motion is a token policy, not a blanket clamp: distances and scale go to zero and
fades keep their duration. Anything sized for a pointer gets a 44px minimum under
`@media (pointer: coarse)`. Both live in `app.css` near the top.

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
- **Hand-tuned SQL stays SQL.** Not just the chat queries — all of it. `db/models.py`
  exists to define the schema and drive Alembic; it is not a query layer. Every read and
  write in the backend is `text()` with bound parameters, and chat history is
  keyset-paginated, never `OFFSET`. One file breaks this and is the only one:
  `services/meetups.py` uses `session.add`, `select()` and `update()` and contains no
  `text()` at all. It is debt, not a precedent — a grep for `session.add(` or `select(`
  under `services/` and `routers/` should return that file and nothing else, and a second
  hit is new drift.
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

`torsor verify` reports failures that are the workspace layout rather than findings, and
they are traps — but only one of them still reproduces:

* **deps** was described here as failing on any `.py` change, because it resolves its
  manifest from `--root` and the Python one is a level down at `apps/api/pyproject.toml`.
  On 2026-09-01 a plain `torsor verify` from the repo root reported `deps: PASS` after a
  branch that changed some sixty Python files. So do not use this note to wave a deps
  failure away: check it. If it fails again, the manifest path is the first thing to look
  at, not the last.
* **staleness** reports ~27 `stale_path`s claiming files like `services/channels.py`,
  `lib/navigation.ts` and `tests/helpers.py` "no longer exist". Every one of them does.
  The notes write paths in the shorthand this file uses, and the checker resolves them
  from the repo root while the code lives under `apps/api/src/blob_api/` and
  `apps/web/src/`. **Do not "fix" these by deleting the references** — that deletes the
  architectural memory the notes exist to hold. (The single `dangling_link` is a
  generated map file where a `Mapping[str, Any]` annotation parsed as a wiki link.)

The gate CI enforces is `torsor guard --strict --severity error`, which is unaffected by
either.
