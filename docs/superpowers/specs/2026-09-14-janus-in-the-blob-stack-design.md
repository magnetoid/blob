# Janus in the Blob stack

**Status:** design, 2026-09-14. Supersedes the Coolify-runner route for this agent.

## What this is

Today `magnetoid/janus` runs as its own Coolify application at
`https://janus.imbamarketing.com`, registered in Blob by URL as an ordinary external app
(`plugins.runtime = 'external'`). Marko's requirement is that Janus be **part of the Blob
deployment** — installed side by side, running side by side, with no separate app to
maintain and no public hostname of its own.

This describes shipping Janus as a service in Blob's own `docker-compose.prod.yml`, opt-in
through a Compose profile, addressed only on the internal network.

## Why not the runner

ADR 0010 built a runner that drives Coolify's API to deploy an agent from a repository, and
`AGENT_RUNNER=coolify` is already configured on both production instances. It was the
obvious answer and it is the wrong one here:

- It makes agent hosting depend on **one PaaS**. Blob is an open-source product other teams
  self-host; "your agent runs if you use Coolify" is not a feature they can use.
- `routers/plugin_hosting.py` already carries a "Coolify-shaped delete-then-create repair"
  for the environment screen. That is the class of complexity that keeps arriving when one
  system orchestrates another through an API it does not own.
- It gives the agent a **public domain**, which is the thing being asked to go away.

Compose needs no orchestration: the operator's own `docker compose up` starts the agent,
the same way it starts Postgres. ADR 0010 is not repealed — a repository agent hosted by
the runner is still a supported shape, and the container runtime and `installFromRepo` stay.
This adds a second, simpler shape for an agent an operator ships *with* Blob.

## Non-goals

- Not vendoring Janus's source into this repo. It stays its own project with its own tests.
- Not removing the Coolify runner, `runtime: "container"`, or `installFromRepo`.
- Not changing the AG-UI contract, the plugin trust model, scopes, budgets or ADR 0013/0017.
- Not making Janus mandatory. A deployment that does nothing gets exactly what it has today.

## Design

### 1. A Compose service, off unless asked for

`docker-compose.prod.yml` gains one service beside `app`, `worker`, `postgres`, `redis`
and `minio`:

```yaml
  janus:
    image: ghcr.io/magnetoid/janus:${JANUS_VERSION:-0.16.0}
    restart: unless-stopped
    command: ["gateway", "run"]
    profiles: ["janus"]
    networks: [agents]
    environment:
      - API_SERVER_ENABLED=true
      - API_SERVER_HOST=0.0.0.0
      - API_SERVER_PORT=8642
      - API_SERVER_KEY=${JANUS_API_SERVER_KEY}
      - BLOB_SIGNING_SECRET=${JANUS_SIGNING_SECRET}
      - JANUS_TUI_PROVIDER=${JANUS_PROVIDER:-deepseek}
      - JANUS_MODEL=${JANUS_MODEL:-deepseek-v4-pro}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - JANUS_MAX_ITERATIONS=${JANUS_MAX_ITERATIONS:-25}
      - BLOB_AGUI_RUN_TIMEOUT_SECONDS=100
      - BLOB_AGUI_KEEPALIVE_SECONDS=15
      - JANUS_GATEWAY_BOOTSTRAP_STATE=running
    volumes:
      - janusdata:/opt/data
```

`profiles: ["janus"]` is the pattern LiveKit already uses in this file and it is there for a
reason recorded on 2026-09-11: an optional dependency must not be able to stop chat from
starting. A deployment that does not set `COMPOSE_PROFILES=janus` never starts this service,
and nothing else in the stack notices.

**No `ports:`, no domain.** The service is reachable only on the `agents` network, which
this file already declares as `blob-agents` (and deliberately not as `external`, so a host
that never ran `docker network create` can still boot). Verified on 2026-09-14 from the live
production app container:

```
http://gateway:8642/v1/agui  ->  401      (alive, refusing an unsigned request)
```

`gateway` is the service name the *existing* standalone deployment uses; in Blob's stack
the service is `janus`, so the address becomes `http://janus:8642/v1/agui`. The probe
proves the network path and the live endpoint, not the final hostname.

`janusdata` joins the existing top-level `volumes:`. The image declares `VOLUME /opt/data`,
so without a named volume every deploy would start from nothing — losing the gateway's
auth, memories and anything installed at runtime.

**No healthcheck**, deliberately, for the reason Janus's own Compose file gives: under s6
the supervised process is not the API server, so container liveness says nothing, and a
check that cannot pass fails the whole deploy.

### 2. The image comes from Janus's CI

`magnetoid/janus` gains a workflow that builds and pushes `ghcr.io/magnetoid/janus` on every
green push to `main`, tagged with both the version from `blob-app.json` and the commit SHA.
Blob pins a tag.

The alternative — a git-URL build context in Blob's Compose file — was rejected: Blob's
deploy is already nine to ten minutes and the server is fixed at one build at a time, so
rebuilding a large Python image on every Blob deploy roughly doubles it, and a Janus build
failure becomes a failed **Blob** deploy. The tested image is the deployed image, which is
the same argument as plan slice 0.1 step 2.

### 3. Installed out of the box

"Out of the box" has to mean nobody registers anything by hand. Blob seeds the plugin row
the way it already seeds its own agent (`services/workspace_agent.ensure_everywhere()`, run
at boot): when `JANUS_AGUI_URL` and `JANUS_SIGNING_SECRET` are both set, ensure a `plugins`
row exists per workspace with

- `slug: "janus"`, `runtime: "external"`, `agui_url: $JANUS_AGUI_URL`
- display name `Janus` by default, overridable with `JANUS_AGENT_NAME`. The **slug** is
  fixed at `janus` — it is the identity the seeder matches on to stay idempotent, and the
  bot's address is derived from it, so it is not something to make configurable. The name
  is what people read and type after `@`, so it is. This mirrors `BLOB_AGENT_NAME` in
  Janus's own connector path rather than inventing a second convention.
- the scopes Janus's own `blob-app.json` declares —
  `messages:read`, `messages:write`, `channels:read`, `channels:join`
- installed with `trusted=False`. That is a parameter of `registry.install`, not a stored
  column: it is what makes `validate_manifest` refuse a manifest claiming a reserved
  runtime. Janus is somebody else's code and holds granted scopes like any app; the
  built-in agent is the only one installed trusted, and that stays true.
- its signing secret written from `JANUS_SIGNING_SECRET` rather than generated.

Everything downstream is then unchanged: it is an ordinary installed agent with a bot user,
a budget, enable/disable, an entry in the agents console, and the same `assert_channel_access`
on every read.

**Why the secret comes from the environment.** Blob normally mints a signing secret at
install, but the Compose service's environment is static and cannot be told a value Blob
invented after it started. One value in the operator's `.env`, read by both sides, is how
the two agree without an orchestration step — and it is already the shape Janus expects
(`BLOB_SIGNING_SECRET`).

Seeding is idempotent per workspace and runs at boot, like the built-in agent's. Turning the
profile off does **not** uninstall it; an admin disables or uninstalls it in the console, so
that a restart cannot quietly remove an agent somebody is using.

### 4. The private address, without opening the guard

`assert_outbound_url` refuses private addresses unless `AGENT_ALLOW_PRIVATE_ENDPOINTS` is
true, and `workspace_policies.may_use_private_endpoints` can narrow that ceiling but never
widen it (`services/policies.py`). `http://janus:8642` is exactly what the guard exists to
refuse when an **admin types it**.

The seeded URL is not typed by anyone: Blob composes it from its own settings. So the seeder
writes it directly and the ceiling stays where it is — `AGENT_ALLOW_PRIVATE_ENDPOINTS`
remains `false` in production, and an admin still cannot register `http://postgres:5432` or
anything else inside the stack.

**There is nothing to build for this.** Checked rather than assumed: the guard is
`_assert_reachable` in `routers/plugins.py`, called on `manifest.request_url` and
`manifest.agui_url` at the two registration routes. Neither `registry.install` nor
`validate_manifest` touches a URL. So a seeder that calls `registry.install` directly is
already outside the guard by construction, and no flag has to be threaded anywhere — which
is the good version of this: the exemption exists because of *where the code path starts*,
not because of a parameter somebody could pass from a route later.

What that leaves is a test rather than a mechanism, and it is the one that must not be
dropped: the same URL the seeder writes is still refused by `POST /api/admin/plugins` while
`AGENT_ALLOW_PRIVATE_ENDPOINTS` is false.

### 5. What is retired

- The Coolify application serving `janus.imbamarketing.com`, once the in-stack service answers.
- The existing `runtime: 'external'` plugin row pointing at that domain. Replaced in place by
  the seeder rather than uninstalled, so the bot user, its channel memberships and everything
  it ever said survive. **Uninstall would retire the bot**, releasing its handle and mangling
  its address, and the sidebar would lose the agent — so the migration is an UPDATE of
  `agui_url`, not a remove-and-reinstall.

### 6. A defect fixed on the way

Janus's `docker-compose.coolify.yml` defaults `JANUS_MODEL=deepseek-chat`. DeepSeek stopped
serving that model on 2026-09-14 and it does not 404 — it returns 200 headers and no body,
so a run hangs until the caller's timeout. A fresh install on defaults would be born broken,
the same way `@Blob` was. The default moves to `deepseek-v4-pro` in both that file and the
new service.

## Phase 2 — the model and key, set from Blob

Asked for after the first draft: *out of the box, but with the option to add a key in Blob's
settings that lands in Janus's settings files.* It depends on Phase 1 and ships after it.

**What Janus's setup actually is.** Its config is a `model.default` (a slug like
`anthropic/claude-opus-4.6`) plus an `inference provider` chosen from a long list —
openrouter, anthropic, deepseek, gemini, zai, copilot, ollama-cloud and about fifteen more —
each of which requires its own named API key. Provider and model move together: the same
model is `deepseek-chat` to DeepSeek's own API and `deepseek/deepseek-chat` through
OpenRouter, and changing one without the other gives a 404 on a name the upstream has never
heard of. Its own Compose file already says so in a comment.

Sources are layered, highest first: environment, then `$JANUS_HOME/config.yaml`, then a
legacy `gateway.json`. `JANUS_HOME` is `/opt/data`, which is the `janusdata` volume — so
**the settings file is already on a volume Blob's stack owns**.

**Where it goes in Blob.** There is no models page today: `LLM_*` is environment-only and
the `This server` group has just General and Appearance. So this adds one section —
`This server → Models` — showing what the built-in agent runs on (read-only, it is
environment) and, when Janus is installed, its provider, model and key.

**The mechanism is an open question and must not be guessed.** Two candidates:

1. **Write the file.** Mount `janusdata` into the app container as well and have the
   endpoint write `config.yaml`. Simple, no change to Janus — but a running gateway has
   already read its config, so something has to make it re-read. Janus has a graceful
   restart path (`gateway/restart.py`, exit 75 = `EX_TEMPFAIL`, which asks its service
   manager to restart after a drain), so under s6 with `restart: unless-stopped` it can
   restart itself. What is *not* established is what triggers that from outside.
2. **Add a config endpoint to Janus.** Its API server exposes `/health`, `/v1/models`,
   `/v1/capabilities`, `/v1/skills`, `/v1/toolsets`, `/v1/agui` and the session routes —
   and nothing that writes configuration. A small authenticated `POST /v1/config` in the
   janus repo, applied through the existing restart path, would be explicit rather than
   two processes sharing a file.

Deciding between them is a spike, not a design choice to make on paper: the question is
whether a config write is picked up without an out-of-band restart, and only running it
answers that. Blob must not try to restart the container itself — it holds no Docker socket
and ADR 0010 refuses to give it one.

**One thing worth having either way.** Janus already answers `GET /v1/models` with what it
can actually serve. The settings page should offer *that list* rather than a free-text box.
Today's outage is the argument: `deepseek-chat` was configured, had been retired upstream,
and failed by hanging rather than by any error a person could read. A picker fed by the
agent's own model list cannot be set to a name that no longer exists.

**Secrets.** The key is written to Janus's config, not stored for display. Blob shows
whether one is set and lets it be replaced, the way `plugin_secrets` are already handled —
shown once, never recoverable.

## Testing

- `tests/test_janus_service.py`: the seeder is idempotent (twice → one row); it does nothing
  when either env value is missing; the row carries the four manifest scopes and
  `trusted = false`; the secret is the configured one, not a generated one; an existing
  `janus` row has its `agui_url` updated in place and keeps its bot user id.
- The private-address seam: an internal URL is accepted from the seeder and still **refused**
  from `POST /api/admin/plugins` while `AGENT_ALLOW_PRIVATE_ENDPOINTS` is false. This is the
  test that matters most — it is the one that fails if the exemption ever widens.
- Compose: `docker compose -f docker-compose.prod.yml config` parses with and without
  `COMPOSE_PROFILES=janus`, and the service is absent from the rendered config without it.
  CI's `image` job already boots the prod stack; it boots it **without** the profile, so the
  default path is proven unchanged.
- Manual, on `chat.imbamarketing.com`: `@Janus` in a channel produces a run card that
  streams, the agents console shows `janus` enabled with its scopes, and
  `curl https://janus.imbamarketing.com/` no longer resolves to anything Blob depends on.

## Risks and what they cost

- **A second image in the stack.** The operator now pulls an agent image they did not build.
  That is the supply-chain statement ADR 0010 already makes in its consequences, and the
  profile means it is opt-in.
- **Release coupling is loose, not absent.** Blob pins a Janus tag, so a Janus upgrade is a
  one-line change here. That is deliberate: `:latest` would make Blob's deploys
  irreproducible.
- **Blob's repo names a specific agent.** Mitigated by the profile being off by default and
  by the service being a worked example the docs point at — but it is a statement, and the
  honest alternative (a generic `agent` service the operator configures) is not "out of the
  box", which is the requirement.

## Open items

- Whether the Hadley instance gets the profile too, or only Imba. Not a design question —
  it is one env var per deployment.
- Janus's own `docker-compose.coolify.yml` keeps working for anyone deploying it standalone.
  Its comment explaining why it dropped the `blob-agents` network becomes wrong for the
  in-stack case and needs a line saying which shape it describes.
