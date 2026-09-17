---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T23:40:24'
updated: '2026-09-16T23:40:24'
---

# apps/api/src/blob_api/routers/admin_janus.py

Symbols in `apps/api/src/blob_api/routers/admin_janus.py`.

- L28 `JanusPartOut` (class) — One of Janus's routes: its answer, or the reason there isn't one.
- L35 `JanusInstallOut` (class)
- L45 `JanusOverviewOut` (class)
- L56 `JanusConfigChangeIn` (class) — The camelCase twin of Janus's `PUT /v1/config` body. Every field optional.
- L74 `JanusAppliedOut` (class) — Janus's answer to a write: what landed, what it warns about, whether it is going.
- L83 `_applied_out(applied: janus_console.Applied)` (function)
- L93 `janus_overview(admin: SessionUser=Depends(require_instance_admin))` (function) — Janus as a whole: what it is, and every workspace that has it.
- L126 `update_janus_config(payload: JanusConfigChangeIn, request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Change what Janus runs on, and by default restart it into the change.
- L149 `restart_janus(request: Request, admin: SessionUser=Depends(require_instance_admin))` (function) — Restart the gateway without changing anything it runs on.
