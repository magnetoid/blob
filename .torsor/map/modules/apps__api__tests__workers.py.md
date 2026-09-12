---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T16:12:28'
updated: '2026-09-12T16:12:28'
---

# apps/api/tests/workers.py

Symbols in `apps/api/tests/workers.py`.

- L18 `worker_index(worker: str)` (function) — `gw3` → 3. xdist names workers this way and nothing else does.
- L26 `per_worker_database(url: str, worker: str)` (function) — `…/blob_test` → `…/blob_test_gw3`, keeping any query string where it was.
- L36 `per_worker_redis(url: str, worker: str)` (function) — `redis://…/15` → `redis://…/12` for `gw3`: counting down from the configured db.
- L52 `worker_environment(environ: Mapping[str, str])` (function) — The overrides for this process: a database and a Redis db of its own under
