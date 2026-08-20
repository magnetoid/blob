---
type: commands
status: active
tags:
- commands
links: []
created: '2026-08-20T16:46:10'
updated: '2026-08-20T16:46:10'
---

# Project Commands

- **check**: `pnpm check` — The gate: tsc + ruff + mypy --strict + the full pytest suite
- **dev**: `pnpm dev` — API on :3000, web on :5173. Run `pnpm worker` in another shell for jobs
- **drift**: `cd apps/api && uv run alembic check` — Models vs live schema. Must stay quiet or autogenerate will propose dropping things
- **lint**: `cd apps/api && uv run ruff check src tests`
- **migrate**: `cd apps/api && uv run python -m blob_api.db.migrate` — Advisory-locked alembic upgrade; the same path the container entrypoint takes
- **test**: `cd apps/api && uv run pytest -q` — Backend tests. Needs Postgres (blob_test) and Redis on localhost
- **typecheck**: `cd apps/api && uv run mypy src`
