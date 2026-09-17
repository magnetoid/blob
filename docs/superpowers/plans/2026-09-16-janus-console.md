# Janus in the console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One page, `Agents & apps → Janus`, where a workspace admin controls the agent every workspace has — on or off, where it is, its budget, its instructions — and the instance admin configures Janus itself through the `GET`/`PUT /v1/config` route Janus 0.17.0 exposes.

**Architecture:** A new service `services/janus_console.py` talks to Janus's API over the internal network with `JANUS_API_SERVER_KEY` (never from a request) and composes one overview; a new router `routers/admin_janus.py` exposes it to instance admins. Per-workspace controls are two small routes on the existing plugin router and one column, `plugins.instructions`, which `jobs/agui_admission` reads into the `Listener` and `plugins/agui.build_run_input` sends as `forwardedProps.instructions`. The client adds one console section built from parts, and the Apps list's Configure for Janus points at it.

**Tech Stack:** FastAPI + `text()` SQL, httpx with a named `open_client` seam, React 19 + vitest, `pnpm openapi`.

**Spec:** `docs/superpowers/specs/2026-09-15-janus-console-design.md` (binding; its "Workspace admins" section is the workspace half). Janus's side is released: `magnetoid/janus` 0.17.0 (`ghcr.io/magnetoid/janus:0.17.0`), documented in that repo's `docs/superpowers/specs/2026-09-15-config-route-for-blob-design.md`.

## Global Constraints

- Branch `janus-console` in the main checkout. Commit per task. Do not push.
- The gate at every commit: `pnpm check && (cd apps/api && uv run alembic check) && torsor guard --strict --severity error $(git ls-files '*.py')`. One pytest process at a time; `pkill -f "pytest -q -n"` after an interrupted run.
- Every SQL statement `text()` with bound parameters; routers hold no `text(`; persist-then-broadcast; private channels answer 404; ids UUIDv7; every write idempotent.
- Wire changes → `pnpm openapi` in the same task; commit `packages/shared/openapi.json` and `src/generated/api.d.ts`.
- **No provider key is ever stored, logged or returned by Blob.** It passes through `PUT /api/admin/janus/config` to Janus and is gone; the audit event names the key, never its value; tests assert the value is absent from every Blob response and from the audit row.
- Janus wire facts (0.17.0): bearer `Authorization: Bearer <API_SERVER_KEY>`; `GET /v1/config` makes a live provider `/models` call (ten-second timeout) and skips it while `restart_pending`; `toolsets` is `{available, enabled, error}` and a `PUT` of `toolsets` must send the **full** `enabled` list (entries not in `available` are dropped if omitted); `warnings` and a 400's `issues` are `{severity, message, hint}`; `restart` must be a JSON boolean; `{"restart": true}` alone restarts without writing; `{"model": {}}` is 400; `raw` over 1 MB and a key over 4 KB are 400; `providers[].key.tail` is absent for a key of four characters or fewer; `agent.personality` is a name from `personalities`; a restart drains for up to `drain_timeout_seconds` (180 default) and `/health` answers again afterwards.
- `.torsor/map`: `git checkout -- .torsor/map` before staging; `torsor map --force` and stage only new/changed-symbol maps.
- Test evidence literal; comments say why.

---

### Task 1: Blob can reach Janus's API — settings, service, routes

**Files:**
- Modify: `apps/api/src/blob_api/config.py` (`JANUS_API_SERVER_KEY: str | None = None`, in `_blank_is_none`, comment beside `JANUS_SIGNING_SECRET`), `docker-compose.prod.yml` (`app:` environment gains `- JANUS_API_SERVER_KEY=${JANUS_API_SERVER_KEY:-}` beside the other `JANUS_*` lines with a two-line why; `JANUS_VERSION` default `0.17.0` in the `janus:` image line), `docker-compose.yml` (same two changes on the dev `janus` service and a note), `.env.example` (the `JANUS_API_SERVER_KEY` comment gains "also read by the app, for the Janus page"), `README.md` (the same sentence in the Janus table)
- Create: `apps/api/src/blob_api/services/janus_console.py`, `apps/api/src/blob_api/routers/admin_janus.py`, `apps/api/tests/test_admin_janus.py`
- Modify: `apps/api/src/blob_api/main.py` (include the router the way `admin_instance` is included)

**Interfaces:**
- Produces: `janus_console.configured() -> bool`; `janus_console.api_base() -> str` (origin of `JANUS_AGUI_URL`); `janus_console.open_client() -> httpx.AsyncClient` (10 s timeout; the seam tests patch); `janus_console.overview(session, workspace_id) -> Overview` (dataclass: `health`, `capabilities`, `config`, `skills`, `toolsets` each `{"data": ... | None, "error": str | None}`, plus `agui_url`, `secret_set: bool`, `installs: list[Install]` where `Install` is `{workspace_id, workspace_name, plugin_id, status, channel_count, runs_last_week}`); `janus_console.update(session, actor, change: ConfigChange) -> Applied` (forwards to `PUT /v1/config`, audits `janus.config_changed` with field names and key names only); `janus_console.restart(session, actor) -> Applied` (`{"restart": true}`).
- Routes: `GET /api/admin/janus` → `JanusOverviewOut`; `PUT /api/admin/janus/config` → `JanusConfigChangeIn` (`model`, `agent`, `toolsets`, `apiKeys`, `raw`, `restart`) → `JanusAppliedOut`; `POST /api/admin/janus/restart` → `JanusAppliedOut`. All `Depends(require_instance_admin)`. Unconfigured → `bad_request("Janus is not running in this stack.", code="janus_not_configured")`; unreachable → `bad_request("Janus did not answer.", code="janus_unreachable")`; Janus 400 → `bad_request(<first issue message>, code="janus_refused")` carrying `issues` in the detail.

- [ ] **Step 1: Failing tests** in `tests/test_admin_janus.py`: a fake Janus as `httpx.MockTransport` answering `/health`, `/v1/capabilities`, `/v1/config`, `/v1/skills`, `/v1/toolsets` (JSON shapes from the Janus spec, with a key `tail` and **no** value), installed through `monkeypatch.setattr(janus_console, "open_client", ...)`; settings on through monkeypatch (`JANUS_AGUI_URL`, `JANUS_SIGNING_SECRET`, `JANUS_API_SERVER_KEY`). Cases: the overview shape; `/v1/skills` failing leaves `skills.error` set and the rest populated; the serialised overview body never contains a planted key value even when the fake returns one in a field Blob does not model (belt and braces); `PUT` forwards exactly the given fields (assert on the request the fake saw) and returns Janus's answer; the audit row names `apiKeys: ["DEEPSEEK_API_KEY"]` and contains no value; Janus 400 → `janus_refused` with the issue text; connection error → `janus_unreachable`; a workspace admin who is not an instance admin → 403; settings off → `janus_not_configured`; `installs` lists the workspace holding the seeded row and not one holding somebody's personal "Janus" (owner set); `POST /restart` sends `{"restart": true}`.
- [ ] **Step 2: Service.** `api_base()` strips the path from `JANUS_AGUI_URL` (`urlsplit` → `scheme://netloc`). `overview()` fetches the five routes concurrently (`asyncio.gather` with `return_exceptions=True`), each into `{"data", "error"}` — an exception becomes `error=f"{type(exc).__name__}: {exc}"` scrubbed of the API key if it ever appeared. Installs: one `text()` query joining `plugins` (`slug='janus' AND runtime='external' AND owner_user_id IS NULL`), `workspaces`, a channel count from `channel_members` via the bot user, and `agent_runs` in the last seven days (reuse `agent_runs.activity_by_plugin` if its shape fits; otherwise one grouped query here). `update()` builds the Janus body from the change (camel → snake at the boundary; `api_keys` values passed through untouched), `PUT`s, maps 400/409/401/connection errors to the codes above, audits through `audit_service.record` with `metadata={"fields": [...], "apiKeys": [names]}`.
- [ ] **Step 3: Router.** Thin: parse, call, shape; `require_instance_admin`; no SQL.
- [ ] **Step 4:** `pnpm openapi`; gate; commit: `feat: let the console read and change Janus's configuration`.

---

### Task 2: What a workspace admin controls — instructions and the everywhere switch

**Files:**
- Create: `apps/api/src/blob_api/db/migrations/versions/0043_plugin_instructions.py` (`plugins.instructions text NULL`; docstring: per-workspace instructions Blob sends with every run to the seeded agent; nothing sends them to an app installed by hand)
- Modify: `db/models.py` (`Plugin.instructions`), `plugins/registry.py` (`set_instructions(session, plugin_id, workspace_id, text | None)`, `set_in_every_public_channel(session, plugin_id, workspace_id, bool)`; `by_id` and the listing select the two columns), `routers/plugins.py` (`PluginOut` gains `in_every_public_channel: bool`, `instructions: str | None`; `POST /{plugin_id}/instructions` with `InstructionsInput(text: str | None, max 4000 chars)` and `POST /{plugin_id}/everywhere` with `EverywhereInput(enabled: bool)`, both `require_admin`, both audited, both refusing an owned plugin with `bad_request("A person's own agent is not the workspace's to place.", code="agent_is_owned")`), `services/channels.py` (no change — the flag is already read at founding)
- Modify: `jobs/agui_admission.py` (`Listener.instructions: str | None`; both admission queries select `p.instructions`), `plugins/streams.py` (`Listener` field), `plugins/agui.py` (`build_run_input(..., instructions: str | None = None)` → `"forwardedProps": {"instructions": instructions} if instructions else {}`), `jobs/agui_outcome.py` (~line 589 passes `listener.instructions`)
- Tests: `tests/test_plugins.py` (the two routes: set, clear, refuse owned, audit rows, `PluginOut` carries both fields; the everywhere switch off → a public channel founded afterwards does not gain the bot, on → it does), `tests/test_agui.py` (`build_run_input` carries `forwardedProps.instructions` only when set; a run for a listener with instructions sends them — assert on the fake agent's received body), `tests/test_janus_agent.py` (the seeded row's instructions reach the fake Janus)

- [ ] **Step 1:** Failing tests. **Step 2:** migration + model (`alembic upgrade head && alembic check`). **Step 3:** registry, routes, listener, run input. **Step 4:** `pnpm openapi`; gate; commit: `feat: a workspace tells its agent how to behave, and where to be`.

---

### Task 3: The page — this workspace's half

**Files:**
- Modify: `apps/web/src/lib/router.ts` (`'janus'` in `ADMIN_SECTIONS`), `apps/web/src/features/console/registry.ts` (the row under *Agents & apps*: `{ id: 'janus', label: 'Janus', description: 'The agent every workspace here has: where it is, what it may spend, how it should behave — and, for the server's admin, what it runs on.', keywords: ['agent', 'model', 'provider', 'deepseek', 'key', 'instructions', 'toolsets', 'skills', 'restart'] }` — **not** `ownerOnly`), `apps/web/src/features/admin/AdminConsole.tsx` (`janus: JanusSection`), `apps/web/src/lib/api.ts` (`admin.janus()`, `admin.updateJanus(change)`, `admin.restartJanus()`, `admin.setPluginInstructions(id, text)`, `admin.setPluginEverywhere(id, enabled)`; `AdminPlugin` gains `inEveryPublicChannel`, `instructions`)
- Create: `apps/web/src/features/admin/sections/janus/JanusSection.tsx` (composition), `Setup.tsx` (unconfigured state: the four env lines with the missing one marked, in the voice of `features/agentic/JanusSetup.tsx`), `ThisWorkspace.tsx` (on/off via `setPluginEnabled`; channels list via `appChannels`/`appJoinChannel`/`appLeaveChannel` reused from the app page; the **Join every public channel automatically** switch; budget via `setPluginBudget`; **Instructions** textarea (4000 chars, Save); the run log via `pluginRuns`; a **Say hello** button that opens the admin's DM with the Janus bot (`api.dms.open` — find the client function the sidebar uses) sends "hello" through the ordinary send path and navigates there), `Installs.tsx` (instance admins only: the workspaces table from the overview), `JanusSection.test.tsx`
- Modify: `apps/web/src/features/admin/sections/AppsSection.tsx` (Configure for the plugin with `slug === 'janus' && runtime === 'external' && !ownerUserId` navigates to `/admin/janus`), `AppsList.test.tsx`

- [ ] **Step 1:** Failing tests: the unconfigured state prints the four lines and marks the missing one; the workspace half renders from a mocked `api.admin.plugins()` row; the everywhere switch calls `setPluginEverywhere`; Save calls `setPluginInstructions` with the text; Say hello opens the DM and sends; the Apps list's Janus row navigates to `/admin/janus`.
- [ ] **Step 2:** Build. The workspace half needs only the plugin row (`api.admin.plugins()` filtered to the seeded identity) and the existing plugin routes — it works for a workspace admin who is not an instance admin, and it works while Janus's API is unreachable.
- [ ] **Step 3:** 400 px sweep on the page; gate; commit: `feat: the Janus page, for the workspace`.

---

### Task 4: The page — this server's half

**Files:**
- Create: `apps/web/src/features/admin/sections/janus/ThisServer.tsx` (composition; shown only when `isOwner`; on a 403 from `api.admin.janus()` shows one line "Only the server's admin can change what Janus runs on."), `Status.tsx` (up/down, version, model, restarting banner polling `api.admin.janus()` every 3 s until `health.data` is back — note the overview skips the provider fetch while restarting, so polling is cheap), `ModelForm.tsx` (provider select from `providers`; model as a select from `models.ids` when present, text field with `models.reason` otherwise; base URL; key field write-only showing "set, ends a4f2" / "set" / "not set" — `tail` may be absent; Save sends only changed fields, `apiKeys` only when typed), `BehaviourForm.tsx` (reasoning effort, max turns, inactivity timeout, personality from `personalities`), `Toolsets.tsx` (checkboxes from `toolsets.available`; **sends the full `enabled` list, keeping entries not in `available`**; shows `toolsets.error` when set), `Skills.tsx` (read-only), `RawConfig.tsx` (monospace textarea holding `raw`; Save sends `raw` alone; Janus's `issues` render beneath; a note that structure is validated, meaning is not), `Restart.tsx` (a button → `restartJanus()`)
- Modify: `JanusSection.tsx` to mount it; `JanusSection.test.tsx` to cover: the model select carries `models.ids` and becomes a text field when null; the key field never renders a value; Save sends only changed fields; the restarting banner appears after a save and clears when the next overview is healthy; Toolsets Save sends the full list including an entry not in `available`; Advanced Save sends `raw` alone and renders an issue; non-owner sees the one-line note and not the forms.

- [ ] **Step 1:** Failing tests. **Step 2:** Build on `.admin-table`, `pref-row` and the console's existing patterns; no new dependency. **Step 3:** 400 px sweep; gate; commit: `feat: the Janus page, for the server`.

---

### Task 5: Records and the rollout

**Files:**
- Modify: `CLAUDE.md` (one sentence under the Janus bullet: the console reads and changes Janus through `services/janus_console.py` over its API, key from `JANUS_API_SERVER_KEY`, never stored), `.torsor/architecture/decisions/0019-*.md` (a "Consequences" line pointing at the console design), `docs/superpowers/specs/2026-09-15-janus-console-design.md` (corrections for anything the build settled differently — the Say-hello mechanism, the routes' final names)
- Verify after the deploy, on chat.imbamarketing.com then Hadley: the page shows DeepSeek / `deepseek-v4-pro` / key set; change reasoning effort → restarting banner → clears → the new value shows; toggle everywhere off, found a channel, the bot is absent; set instructions "Answer in one sentence." → `@Janus` in a channel answers in one sentence; Say hello reaches the DM.

- [ ] Gate; commit: `docs: record the Janus page`.
