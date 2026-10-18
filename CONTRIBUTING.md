# Contributing to Blob

Blob is an open-source, self-hosted, agent-native team chat. Every feature ships in this
repository under one licence; there is no enterprise tier to keep anything back for.

## Before you build

1. **Read the decision first.** `.torsor/architecture/decisions/` holds the ADRs; the
   agentic ones (0013–0025) in particular depart from earlier rules on purpose. The traps
   list in `.torsor/active/context.md` records failures this codebase has already had —
   read the entries for the code you are about to touch.
2. **Check what exists.** The README's "What isn't built yet" says what is missing; a
   column or a disabled button is not evidence a feature exists.
3. **Look up the current answer** before choosing a dependency, protocol or platform API,
   and say what you found. Client code means Chrome, Firefox and Safari today.

## Setting up

```bash
docker compose up -d                       # Postgres, Redis, MinIO, MailHog, LiveKit
cp .env.example .env                       # then set SESSION_SECRET (openssl rand -hex 32)
pnpm install && (cd apps/api && uv sync)
pnpm migrate
pnpm dev                                   # API on :3000, web on :5173
pnpm worker                                # second shell
```

Tests need Postgres (`blob_test`) and Redis on localhost. Start MinIO too: without it the
attachment tests **skip**, which is green while proving nothing.

## The gate

A change is ready when all of this passes — it is what CI runs, and a merge to `main`
deploys to production:

```bash
pnpm check                                 # tsc, eslint (no warnings), ruff + format, mypy --strict, vitest, pytest
(cd apps/api && uv run alembic check)      # models match the live schema
torsor guard --strict --severity error $(git ls-files '*.py')
```

## Rules the code depends on

- **SQL is `text()` with bound parameters**, in `services/` — never in a router, never the
  ORM as a query layer, never `OFFSET` (keyset pagination). Only code may be interpolated
  into a statement; `tests/test_sql_interpolation.py` holds that.
- **Persist, then broadcast.** Emit events from `transaction()`'s `after` callbacks, past
  COMMIT — never from inside a transaction.
- **Every write is idempotent on a client-supplied id.** Ids are UUIDv7; their sort order
  is load-bearing.
- **Error codes are a contract** with the client (`lib/errors.py` ↔ `apps/web/src/lib/api.ts`).
  Do not rename one. FastAPI's 422 stays remapped to 400 `invalid_input`.
- **Private means 404.** A private channel answers 404 to an outsider, everywhere.
- **The socket protocol has two hand-written twins** (`realtime/protocol.py`,
  `packages/shared/src/protocol.ts`); `test_protocol_parity.py` compares them. Change
  both, and run `pnpm openapi` after any change to a route's shape.
- **Migrations are numbered in sequence.** Run `uv run alembic heads` before writing a
  `down_revision`; a second head fails every test at setup.
- **The 44 colour token names** in `styles/tokens.css` are a by-index contract with
  `services/themes.py`. Do not rename or reorder them.
- **Agents are reached through AG-UI and the tool catalogue**, never through anything
  specific to one agent. Janus, the agent Blob seeds, is a separate project with its own
  releases; a feature that only Janus could use does not belong here.

## Commits and pull requests

One change per commit, with a message that says what changed for the person using Blob
and why. Tests come with the change, written so that they fail without it. A pull request
that changes behaviour updates the in-app guide (`apps/web/src/lib/help.ts`) and the
README if either describes it.

A release is one commit that bumps the version in the four `package.json` files, adds the
entry to `apps/web/src/lib/changelog.ts` and runs `pnpm stamp`, followed by an annotated
tag on that commit: `git tag -a v1.11.0 -m "1.11.0 — <the headline>"`.

Security issues go through private reporting — see [SECURITY.md](SECURITY.md).
