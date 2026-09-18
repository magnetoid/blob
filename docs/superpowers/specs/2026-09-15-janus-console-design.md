# Janus in the instance console

**Status:** design, 2026-09-15. Supersedes "Phase 2" of
`2026-09-14-janus-in-the-blob-stack-design.md`, whose open question — how a setting made in
Blob reaches a running Janus — is settled here.

**Built** on branch `janus-console`, 2026-09-17, in five tasks. The design below stands as
written; where the build settled something differently the section carries an **As built
(2026-09-17)** note at its end, and that note is the one to believe.

## What this is

Janus runs inside Blob's stack as a service (`docker-compose.prod.yml`, profile `janus`),
seeded into every workspace as an installed app. Everything about *that workspace's* use of
it — channels, budget, enable or disable, uninstall — is on the app's own page under
`/admin/apps/{id}`, and belongs there. Nothing in Blob shows or changes what Janus *is*:
the model it answers with, the provider and key behind it, how long it may think, which
toolsets it may use. Today that is one file on a volume — `/opt/data/config.yaml`, plus a
`.env` beside it for keys — edited by hand over `docker exec`, and a restart.

This adds one page to the instance console, `Agents & apps → Janus`, that an instance admin
uses to see Janus as a whole and to change it, and one route to Janus that makes the change
land and take effect.

Three decisions were taken with Marko on 2026-09-15:

1. **Janus gains `PUT /v1/config`.** Blob never writes the file and never touches Docker.
   The route lives in the `magnetoid/janus` repository, applies the change to Janus's own
   files through Janus's own config code, and restarts the gateway the way its `/restart`
   command already does. Rejected: mounting the volume into the app container and writing
   `config.yaml` from Blob — no Janus change, but a running gateway does not re-read the
   file, so nothing takes effect until somebody restarts the container by hand.
2. **Curated fields plus an Advanced tab.** Provider, model, key, base URL, reasoning
   effort, max turns, inactivity timeout, toolsets on or off, personality — as a form. Below
   it, the whole of `config.yaml` as editable YAML, validated by Janus before it is applied.
   Every feature reachable without forty form fields, and without a form that has to be
   kept in step with every Janus release.
3. **Janus stays in the Apps & agents list.** It is still an installed app in each
   workspace. Its row's Configure goes to the Janus page instead of the generic app detail.

## What Janus offers today, and what it does not

Verified in `magnetoid/janus` at `b5ea259`:

* The API server (`gateway/platforms/api_server.py`) exposes, bearer-authenticated with
  `API_SERVER_KEY`: `/health`, `/v1/models`, `/v1/capabilities`, `/v1/skills`,
  `/v1/toolsets`, `/v1/agui`, chat completions, responses and runs. **Nothing reads or
  writes configuration.**
* `GET /v1/models` answers with the *one* model Janus is configured to answer as — not the
  provider's catalogue. A picker cannot be fed from it.
* Configuration is `$JANUS_HOME/config.yaml` (`/opt/data` in the container), merged over
  `DEFAULT_CONFIG` by `janus_cli.config.load_config()`. `read_raw_config()` returns the
  user's file alone. `set_config_value("a.b", v)` writes a dotted key into the raw file
  atomically; `save_config()` writes the merged whole. `validate_config_structure()`
  returns a list of `ConfigIssue`s with a severity.
* **API keys go to `.env`, not `config.yaml`.** `set_config_value` routes any
  `*_API_KEY`/`*_TOKEN` name to `save_env_value()`, which writes `$JANUS_HOME/.env`, and
  `janus_cli/env_loader.py` loads that file with `override=True` at start. That matters
  for this stack: the compose file passes `DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}` into the
  container, so an operator who never set it has an *empty* variable in the environment —
  and a value in `.env` still wins over it. A key saved from Blob therefore takes effect at
  the next start with no compose change.
* In a container, `/restart` calls `request_restart(detached=False, via_service=True)`:
  the gateway drains running turns (`agent.restart_drain_timeout`, 180 s), then exits 75,
  and s6-overlay — PID 1 in the image — starts it again. The API server adapter has no
  handle on the gateway today; the runner gives every adapter a message handler through
  `set_message_handler` and nothing else.
* `is_managed()` (NixOS / systemd-managed installs) refuses every config write. The Docker
  image sets no such marker.

## Janus side

Release **0.17.0** of `magnetoid/janus` (`blob-app.json` and `pyproject.toml` both carry the
version; `image.yml` publishes `ghcr.io/magnetoid/janus:0.17.0` on a green push to main).

### `GET /v1/config`

Bearer-authenticated like every `/v1/*` route. Answers what the page shows:

```json
{
  "object": "janus.config",
  "version": "0.17.0",
  "model": {"default": "deepseek-v4-pro", "provider": "deepseek",
            "base_url": "https://api.deepseek.com/v1"},
  "agent": {"max_turns": 60, "reasoning_effort": "medium", "gateway_timeout": 1800,
            "personality": "helpful"},
  "personalities": ["helpful", "concise", "technical", "..."],
  "toolsets": {"available": ["janus-cli", "web", "..."], "enabled": ["janus-cli"]},
  "providers": [
    {"id": "deepseek", "env": "DEEPSEEK_API_KEY", "key": {"set": true, "tail": "a4f2"}},
    {"id": "openrouter", "env": "OPENROUTER_API_KEY", "key": {"set": false}}
  ],
  "models": {"provider": "deepseek", "ids": ["deepseek-flash", "deepseek-v4-pro"]},
  "raw": "model:\n  default: deepseek-v4-pro\n...",
  "restart_pending": false
}
```

* `model` and `agent` are read from the *effective* config (`load_config()`), so a value
  Janus is running on shows even when the file does not name it. `raw` is the user's file
  verbatim (`read_raw_config()` re-serialised, or the file's text), which is what the
  Advanced tab edits.
* `providers` lists the providers Janus knows with the environment variable each reads its
  key from, and whether one is present — `set` and the last four characters, never the
  value. "Present" means set in the process environment or in `$JANUS_HOME/.env`.
* `models.ids` is the *provider's* list, fetched live from `{base_url}/models` for the
  configured provider when it speaks the OpenAI shape and a key is present (DeepSeek and
  OpenRouter do; Anthropic's list needs its own headers and is a follow-up). Ten-second
  timeout; on any failure `ids` is `null` with a one-line `reason`, and Blob shows a text
  field instead. This is the whole point of a picker: `deepseek-chat` was retired upstream
  and failed by hanging, not by any error a person could read, and a list the provider
  itself serves cannot be set to a name it no longer knows.
* `restart_pending` is true between a `PUT` that asked for a restart and the exit.

### `PUT /v1/config`

Body — every key optional, at least one required:

```json
{
  "model": {"default": "...", "provider": "...", "base_url": "..."},
  "agent": {"max_turns": 60, "reasoning_effort": "high", "gateway_timeout": 1800,
            "personality": "concise"},
  "toolsets": ["janus-cli", "web"],
  "api_keys": {"DEEPSEEK_API_KEY": "sk-..."},
  "raw": "model:\n  default: ...\n",
  "restart": true
}
```

Semantics, in order:

1. **Refuse** with 409 when `is_managed()`, with 400 when the body is empty, when `raw` is
   given alongside any of `model`/`agent`/`toolsets` (one or the other — a merged edit and a
   whole-file edit cannot both be the truth), or when `api_keys` holds a name that is not
   `^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN)$` or is on Janus's env denylist.
2. **`raw`** is parsed with `yaml.safe_load`; anything but a mapping is 400. The result is
   run through `validate_config_structure`; any `error`-severity issue is 400 carrying the
   issues, and warnings come back in the 200 body. On success the file is replaced with
   `atomic_yaml_write`, keys in the order given — exactly what `set_config_value` does for
   one key, for all of them.
3. **`model` / `agent` / `toolsets`** are merged into the *raw* user file, dotted-key by
   dotted-key (`model.default`, `agent.reasoning_effort`, `toolsets`), through the same
   `_set_nested` + `atomic_yaml_write` path `set_config_value` uses — never through
   `save_config`, which would dump every default into the operator's file. Validation as
   for `raw`, on the merged result.
4. **`api_keys`** go to `$JANUS_HOME/.env` through `save_env_value`, one by one. An empty
   string removes the key. Values are never logged and never echoed.
5. **`restart`** (default true) asks the gateway for the same graceful restart `/restart`
   performs. The response says so: `{"applied": {"model": {...}, "agent": {...},
   "api_keys": ["DEEPSEEK_API_KEY"]}, "warnings": [...], "restarting": true,
   "drain_timeout_seconds": 180}`. With `restart: false` the write lands and nothing
   re-reads it, which the response states plainly (`"restarting": false`).

### Wiring the restart

`BasePlatformAdapter` gains `set_restart_handler(handler)` beside `set_message_handler`.
The runner sets it on every adapter it starts, to the function `/restart` calls — the one
that detects a container or a service manager and chooses exit-75 over a detached re-exec.
Only the API server adapter uses it. An adapter with no handler set answers the `PUT` with
`"restarting": false` and a warning naming the reason, so a standalone API server (the
`janus api` command, not the gateway) still accepts the write.

### Tests

`tests/gateway/test_api_server_config.py`, beside the existing `test_api_server*.py`, on a
temporary `JANUS_HOME`:

* `GET` masks keys — the value appears nowhere in the body, `tail` is four characters,
  `set` is false for an unset provider.
* `GET` `raw` is the file's content and `model` is the effective value when the file is
  empty.
* `PUT` with `model.default` writes that one key and leaves an unrelated key untouched
  (diff the file before and after).
* `PUT raw` replaces the file; a scalar YAML is 400; a structure error is 400 with the
  issue text; a warning-only file is written and the warning is returned.
* `PUT` `raw` together with `model` is 400.
* `PUT api_keys` writes `.env` and the response does not contain the value; a name outside
  the pattern is 400; an empty value removes the key.
* `PUT` calls the restart handler exactly once and answers `restarting: true`; with no
  handler set, `restarting: false` with the warning; with `restart: false`, not called.
* Every route is 401 without the bearer.
* `is_managed()` true → 409, and the file is untouched.

Then the release: version 0.17.0 in both files, `git push`, `image.yml` green, and the tag
visible on GHCR. **Commit only the files this work touches**: the checkout carries five
modified files (`janus_cli/dep_ensure.py`, `janus_cli/main.py` and three tests) that are
not this work's and must not ride along.

## Blob side

### Settings and compose

* `JANUS_API_SERVER_KEY: str | None = None` in `config.py`, in `_blank_is_none`. It is the
  bearer for Janus's API — the same value the compose file already hands the `janus`
  service as `API_SERVER_KEY`. The `app` service gets `JANUS_API_SERVER_KEY=${JANUS_API_SERVER_KEY:-}`;
  the worker does not, because only the console page talks to this API. `.env.example`
  and the README row gain the sentence "also read by the app, for the Janus page".
* `JANUS_VERSION` default in the compose file moves to `0.17.0`.
* The page is *configured* when `janus_agent.configured()` holds and the key is set. With
  the URL and secret but no key, the page shows the agent and explains the one missing
  line rather than pretending nothing is running.

### Service — `services/janus_console.py`

The instance console's view of Janus. No SQL in the router; the workspace facts below are
this module's queries.

* `configured() -> bool`.
* `api_base() -> str`: the origin of `JANUS_AGUI_URL` (`http://janus:8642`). Derived, not a
  second setting: it is the same server by construction, and a second URL is a second thing
  to get wrong. Never taken from a request, which is why `_assert_reachable` does not apply
  — the same reasoning `services/janus_agent.py` records.
* `open_client() -> httpx.AsyncClient`: the named seam tests patch, exactly as
  `lib/llm.open_client` is and for the reason its docstring gives. Ten-second timeout.
* `overview(session) -> Overview`: one call from the page. Composes Janus's `/health`,
  `/v1/capabilities`, `/v1/config`, `/v1/skills` and `/v1/toolsets` — **each part
  independently**, so a route that fails degrades that tile and nothing else ("fail toward
  the workspace staying up") — plus Blob's own facts: the AG-UI address, whether the secret
  is set, and every workspace holding the seeder's row (`existing_id`'s identity: slug
  `janus`, runtime `external`, no owner) with its name, the app's status, the bot's channel
  count and its runs in the last seven days from `agent_runs`.
* `update(session, actor, change) -> Applied`: forwards the curated fields, `api_keys` and
  `raw` to `PUT /v1/config` as given, returns Janus's answer, and writes one audit event
  naming the fields and the *names* of any keys changed — never a value. Janus's 400 issues
  are re-raised as `bad_request` with the issue text so the page can show them beside the
  editor; a connection failure is `bad_request("Janus did not answer.", code="janus_unreachable")`,
  inline, the way `services/meetups.py` raises `livekit_not_configured`.

**As built (2026-09-17).**

* The client timeout is **twelve** seconds, not ten. Janus's own `GET /v1/config` budgets
  ten for the live provider call behind `models.ids`, so a ten-second deadline here
  reported an unreachable Janus that was merely busy asking DeepSeek what it serves.
* `overview(session, workspace_id)` takes the caller's workspace, and each install row
  carries `is_this_workspace` so the page can *mark* the row that is the reader's own — a
  label rather than the link the plan called for, for the reason in the `Installs.tsx`
  note below. The five Janus parts are fetched *before* the installs query opens, so no
  pooled connection is held across the twelve-second fan-out.
* A fourth path for a key that the design did not anticipate: one written by hand into
  `config.yaml` (a `custom_providers` entry takes its own `api_key`) comes back inside
  `raw`, which Janus returns verbatim. So `raw` is redacted on the way out — the value of
  any key named or ending `api_key` (also `api-key`/`apiKey`)/`token`/`secret`/`password` becomes the fixed
  placeholder `«redacted»` — and a submitted `raw` still carrying that placeholder is
  refused before Janus sees it, rather than writing the word into the file as the key.
  Exempt: `${VAR}`, which Janus expands from the environment and its documentation
  recommends as the way to keep a key out of the file, and the values that are nothing at
  all — empty, quoted-empty, `null`, `~`. Redacting either showed a placeholder for
  something that was never secret and made the Advanced tab unsaveable, because the
  refusal's advice, *put the key back*, is wrong where there is no key to put back. A bare
  `$VAR` is **not** exempt: Janus does not expand it, so it is a literal string and a
  credential like any other.
* The redaction is a line rule, not a parse, because it also has to work on text that does
  not parse — a YAML error quoting the line it choked on. Its blind spots are named rather
  than claimed away: a flow map (`{api_key: …}`), a block scalar (`api_key: >` with the
  value indented beneath), a plain scalar on the line after its key, a quoted key name,
  and a multi-line quoted scalar. Ruled sufficient for this slice — Janus's own docs and
  `janus config set` write none of those shapes, and the cost if wrong is a key in an
  unusual YAML shape shown to an instance admin on their own server. The structural fix is
  **Janus-side redaction, recorded as a 0.17.1 follow-up**.
* Everything built out of Janus's answer is scrubbed against the credentials the request
  is carrying — the refusal message, its issues, *and* the 200 success body — because a
  PyYAML error quotes the offending line back. Values under eight characters are still
  redacted from the file but are not used as scrub needles: `OLLAMA_API_KEY=none` is what
  a local model wants, and a four-letter needle would turn every "none" in Janus's own
  words into `***`, mangling the sentence an operator has to read.
* Two refusals are Blob's own and are raised before the call: `janus_empty_change` (a body
  with nothing in it but `restart` — "do nothing at all" must not read as a save that
  worked) and `janus_raw_redacted`. `janus_refused` keeps its meaning of *Janus saw this
  and said no*, so a code never misnames who refused and sends the next reader to the
  wrong logs.
* `restart(session, actor)` sits beside `update` for the restart-with-no-change path.

### Routes — `routers/admin_janus.py`

Prefix `/api/admin/janus`, every route `Depends(require_instance_admin)`:

* `GET /api/admin/janus` → `JanusOverviewOut`.
* `PUT /api/admin/janus/config` → `JanusConfigChangeIn` (camelCase twins of the Janus body:
  `model`, `agent`, `toolsets`, `apiKeys`, `raw`, `restart`) → `JanusConfigAppliedOut`.
* Unconfigured → `bad_request("Janus is not running in this stack.", code="janus_not_configured")`.

`pnpm openapi` regenerates the contract; `test_openapi_contract.py` enforces it.

**As built (2026-09-17).**

* A third route: `POST /api/admin/janus/restart` → `JanusAppliedOut`, the page's Restart
  button. Restarting without changing anything was a thing the design's `PUT` could only
  do by sending a field it did not mean.
* The schema names are `JanusOverviewOut` (a `JanusPartOut` — `{data, error}` — per Janus
  route, plus `JanusInstallOut` per workspace), `JanusConfigChangeIn` and
  `JanusAppliedOut`. `data` is deliberately untyped: Janus's `/v1/config` grows fields
  every release and a Blob-side mirror would be a second thing to keep in step. The one
  field that is *about* a secret, `providers[].key`, is narrowed in the service instead,
  where it cannot be forgotten.
* `janus_refused` carries the issues as structured data, not only as a sentence:
  `AppError` and `bad_request` gained an optional `detail`, and `ApiError.detail` on the
  client unwraps it, so the Advanced box lists every issue Janus raised beside the editor
  rather than the first line of the refusal.

### Client

* `lib/router.ts`: `'janus'` joins `ADMIN_SECTIONS`. `console/registry.ts`: one row under
  *Agents & apps* — `{ id: 'janus', label: 'Janus', description: 'The agent that runs beside
  this server: its model, its key, and everything else it is set up with.', keywords:
  ['model', 'provider', 'deepseek', 'key', 'toolsets', 'skills', 'restart'], ownerOnly: true }`.
  `AdminConsole.tsx`: `janus: JanusSection`.
* `features/admin/sections/janus/` — `JanusSection.tsx` composes, the parts sit beside it:
  * **Setup** (unconfigured): the four lines that turn it on — `COMPOSE_PROFILES=janus`,
    `JANUS_AGUI_URL`, `JANUS_SIGNING_SECRET`, `JANUS_API_SERVER_KEY` — with the one that is
    missing marked, in the voice of `features/agentic/JanusSetup.tsx`.
  * **Status**: up or down, version, the model it answers as, and a *restarting* state.
    After a save the page polls `GET /api/admin/janus` every three seconds until `/health`
    answers again, then shows what it now runs on. The drain can take up to 180 s and the
    banner says so.
  * **Model and provider** (`ModelForm.tsx`): provider select from `providers`; model as a
    select from `models.ids` when present and a text field when null, with the reason; base
    URL; the key as a write-only field that reads "set, ends a4f2" or "not set" and takes a
    new value — described, not printed, the rule `AgentConfig.tsx` already states. Save
    sends only the fields that changed.
  * **Behaviour** (`BehaviourForm.tsx`): reasoning effort, max turns, inactivity timeout,
    personality (select from `personalities`).
  * **Toolsets** (`Toolsets.tsx`): a checkbox per available toolset; **Skills**: read-only.
  * **Where it is installed** (`Installs.tsx`): the workspaces table — name, status,
    channels, runs 7d — on `.admin-table`; the current workspace's row links to
    `/admin/apps/{id}`.
  * **Advanced** (`RawConfig.tsx`): a monospace `<textarea>` holding `raw`, Save sends
    `raw` alone, and Janus's issues render under it. No editor dependency: a textarea is
    what the bundle ratchet allows and what a YAML file needs.
* `AppsSection.tsx`: the row whose plugin is the seeder's (slug `janus`, runtime
  `external`, no owner) routes Configure to `/admin/janus`.
* `lib/api.ts`: `admin.janus()` and `admin.updateJanus(change)`.

**As built (2026-09-17).**

* The registry row is **not** `ownerOnly` — the "Workspace admins" section below is what
  the build followed. A workspace admin opens the page; the server half is a block inside
  it, and an admin who is not the instance admin sees one line saying who can change it.
* `lib/api.ts` gained `admin.restartJanus()` beside the other two.
* Reasoning effort is Janus's own list — `none`, `minimal`, `low`, `medium`, `high`,
  `xhigh` (`janus_constants.VALID_REASONING_EFFORTS`, with `none` ahead of it, which
  `parse_reasoning_effort` takes as "do not ask for reasoning") — not an invented three.
  `/v1/config` lists the personalities it knows and not the efforts, which is why this one
  list is Blob's copy and says so.
* The key field is write-only *and cleared whenever the provider select changes*:
  `apiKeys` is keyed by the selected provider's variable, so a key pasted for DeepSeek and
  left sitting while the select moved would have been written under `OPENAI_API_KEY`.
  Every select renders its current value even when that value is not in the list it was
  offered, so an unexpected provider is never a blank box inviting a change.
* The parts as built: `Setup`, `Status`, `Restart`, `ThisWorkspace`, `ThisServer`,
  `ModelForm`, `BehaviourForm`, `Toolsets`, `Skills`, `Installs`, `RawConfig` and
  `Issues`, with `config.ts` and `apply.ts` holding the read/write helpers the forms share
  and `seeded.ts` holding the identity predicate the page, the row it finds and the Apps
  list's Configure all ask.
* **Where it is installed** (`Installs.tsx`): the reader's own workspace row is *marked* —
  `this one`, under the name — and links nowhere. The plan above had it linking to
  `/admin/apps/{id}`, but for the seeded row that is not the page Janus is configured on:
  the Apps list routes that row's Configure to `/admin/janus` (`AppsSection.tsx`), which
  is this page, so the link would have led back to where the reader already was. The row
  in the nav is the other way here, one click away. `is_this_workspace` still comes down
  on every row; marking is all it is asked for.
* **Setup** shows only when no `janus`-slugged row exists at all. A row that wears the
  slug without the identity — somebody's own agent, or one dialling in over a socket —
  gets the workspace half with the two controls *inert and explained*, because sending an
  admin to a page that says "install Janus" while Janus is right there answering is a lie.

### Tests

* `tests/test_admin_janus.py` (backend), Janus faked through `janus_console.open_client`
  with an `httpx.MockTransport` answering the five routes: the overview shape; a failing
  `/v1/skills` leaves `skills.error` set and everything else populated; the key's value is
  absent from the overview even when the fake returns it (belt and braces on the mask);
  `PUT` forwards exactly the given fields and returns Janus's answer; the audit event
  names the key and never carries the value; Janus 400 → 400 with the issues; Janus down →
  `janus_unreachable`; a workspace admin who is not an instance admin is refused; unset
  settings → `janus_not_configured`; the workspaces table lists a workspace holding the
  seeded row and not one holding somebody's personal "Janus".
* `JanusSection.test.tsx`: the unconfigured page prints the four lines and marks the
  missing one; the model select carries `models.ids` and becomes a text field when they
  are null; the key field never renders the value; Save sends only changed fields; the
  restarting banner appears after a save and clears when the next overview is healthy;
  Advanced Save sends `raw` alone and renders an issue. `AppsSection` gains the redirected
  Configure case. The 400 px sweep on the table and the textarea.

## Secrets and who may reach this

* Blob never stores a provider key. It passes through the app process to Janus over the
  internal network and is gone. Nothing in Blob's database, logs or audit trail carries
  it. Janus stores it where Janus's own `config set` would.
* `JANUS_API_SERVER_KEY` is full control of Janus's API — runs, config, restart. Only
  instance admins reach the routes that use it, and it is a setting, never a request
  field.
* The API base is derived from a setting and never from input, so the SSRF guard on the
  registration routes is not bypassed here; there is no user-supplied URL.

**As built (2026-09-17).** The first bullet holds, and a key turned out to reach Blob by
four routes rather than one: Janus's own mask (narrowed again here rather than relayed —
"the other side promised" is not a defence for a secret), a key written by hand into
`config.yaml` and returned inside `raw`, anything built out of Janus's *answer* (a parse
error quotes the line it choked on), and the audit row. See the service section's note for
each; Janus-side redaction of `raw` is the recorded 0.17.1 follow-up.

## Rollout

1. Janus first: implement, tests, 0.17.0, push, `image.yml` green, `ghcr.io/magnetoid/janus:0.17.0`
   present.
2. Blob: implement against the fake; compose defaults `JANUS_VERSION` to `0.17.0` and gives
   `app` the key; one commit on main through the gate. Both Coolify apps already hold
   `JANUS_API_SERVER_KEY` for the `janus` service, so no Coolify change.
3. Verify on chat.imbamarketing.com, then Hadley: the page shows DeepSeek and
   `deepseek-v4-pro` with the key "set"; change reasoning effort, watch the restarting
   banner clear, see the new value; mention `@Janus` and get an answer. The same on the
   second instance the next day is the bar for calling it done.

## Workspace admins

Decided later the same day, with the built-in agent's retirement
(`2026-09-15-janus-is-the-agent-design.md`): the page serves the *workspace* admin first,
because Janus is now the one agent every workspace has, and the server-level parts above
are the instance admin's section of it. So `/admin/janus` is reachable by a workspace
admin or owner — not `ownerOnly` in the registry — and the page is two halves:

* **This workspace** (any admin): on or off; the channels it is in, with the
  `in_every_public_channel` flag as a switch — "Join every public channel automatically"
  — so a workspace can choose invitation-only; the daily run budget; **instructions**, a
  per-workspace text Blob sends with every run as `forwardedProps.instructions`, which
  Janus 0.17.0 prepends to its system prompt (the Janus release gains that alongside the
  config route); the run log for this workspace; a **"Say hello"** probe that starts a
  run in the admin's DM with Janus and shows the reply, so "is it working?" has a button.
  These are the workspace's own row, and every write goes through the plugin routes that
  exist (`PUT /api/admin/plugins/{id}` gains `inEveryPublicChannel` and `instructions`).
* **This server** (instance admin only, hidden otherwise with one line saying who can
  change it): everything in "Blob side" above — model and provider, key, behaviour,
  toolsets, skills, Advanced YAML, the restart.

`plugins.instructions text NULL` joins the schema (migration alongside 0040–0042, or the
next free number), sent only for the seeded agent — an app installed by hand never sees
a field its author did not declare.

**As built (2026-09-17).**

* `plugins.instructions` is migration **0043**, and a run carries it as
  `forwardedProps.instructions` only when the row is the seeded one — a `CASE` in both
  admission queries, so the run path forwards nothing for any other row however the column
  is set.
* The two writes are **their own routes**, not fields on `PUT /api/admin/plugins/{id}`:
  `POST /api/admin/plugins/{id}/instructions` (`{text}`) and
  `POST /api/admin/plugins/{id}/everywhere` (`{enabled}`). Each field is required with no
  default, because `extra="ignore"` is the wire's rule and a misspelt or missing key on a
  `PUT` would have read as "clear the workspace's prompt" or "stand the agent down from
  every room founded from now on", with nothing on screen to say why. `text` is trimmed
  before the 4000-character check (Janus's ceiling) — a textarea hands back the newline
  the person ended on — and an empty, blank or explicitly null text clears it.
* **Seeded-only is held on the server, not by hiding the field.** Both routes refuse an
  owned row with `agent_is_owned` ("a person's own agent is not the workspace's to
  instruct/place" — ADR 0018, and it is checked first because it is the case an admin can
  undo) and anything else with `agent_not_seeded`. The page renders the two controls inert
  with the reason rather than hiding them, so the refusal and the display agree.
* Three reads were corrected while the flag became a switch somebody may turn off:
  `services/users.agent_resident` (the home view's pick) reads the **seeded identity**,
  not the flag, so choosing invitation-only no longer stops the home view addressing the
  agent at all; `services/janus_agent.ensure()`'s boot backfill reads the switch on an
  existing row, so a switch turned off is not turned back on by the next deploy — it was
  the flag undone by the thing that honours it; and `services/channels.create_channel`'s
  auto-join requires the identity **as well as** the flag, so a Janus later handed to a
  person stops being seated in public channels founded afterwards.
* The identity itself lives in `services/seeded.py` and nowhere else — one definition with
  five readers (`janus_agent.existing_id`, both admission queries, `users.list_users`,
  `channels.create_channel`, the two plugin routes) plus the client's `seeded.ts` twin.
  Its own module rather than `janus_agent`'s, because `channels.create_channel` became a
  reader and `janus_agent` imports `channels.add_members`: the identity in the module that
  owns the seeder is an import cycle in the module that founds a channel. It is a *shape*,
  not a provenance — a row hand-installed with slug `janus`, runtime `external` and no
  owner would count, and only a provenance column would close that.
* **"Say hello"** is `api.dms.open([botUserId])`, then the store's ordinary
  `sendMessage`, then navigate to the DM. The ordinary send path on purpose: a probe that
  took a route of its own would prove the route of its own works. The navigation is last,
  so a send that fails leaves the admin on the page that can explain why.

## Not in this

* The model for Catch-up and summaries. It is environment-only (`LLM_*`) and stays so;
  the page is Janus's.
* Skill installation or removal, SOUL.md, platform connectors (Telegram and the rest),
  Janus's own dashboard. Everything under `raw` is reachable through the Advanced tab; a
  form for any of it is a later decision.
* Provider catalogues for providers whose `/models` is not OpenAI-shaped: they get the text
  field.

## Risks

* **The restart under s6.** `/restart` in a container is exit 75 and the supervisor
  restarts the process; the compose comment records that under s6 "the supervised process
  is not the API server". The Janus task verifies, on the deployed image, that a `PUT` with
  `restart: true` brings the gateway back with the new value — before Blob's side is built
  on it. If it does not, `restarting: false` plus a "restart the container" note is the
  honest fallback and the page says so.
* **A bad `raw`.** Janus validates structure, not meaning: a provider name that exists and
  a model that does not passes validation and fails at the first run. The picker exists to
  make the common case impossible; the Advanced tab is for people who accept the risk, and
  the page says that too.

**As built, 2026-09-18 — where the redaction lives.** Janus 0.17.1 redacts `raw` at the
source: `GET /v1/config` parses `config.yaml` with the round-trip loader and replaces every
value under a credential-named key with `«redacted»` before the text leaves the process
(flow maps, block scalars, quoted keys and lists included), and `PUT` refuses a `raw` that
still holds the placeholder. Blob's `redact_secrets` stays as defence in depth with the same
placeholder, and the compose files pin `0.17.1`.
