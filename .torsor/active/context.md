---
type: active-context
status: active
tags: [active]
---

# Active Context

## Current focus

**The entrances, systematically.** A sweep for client methods and server routes with no
control found five more of what pins and custom emoji had already been twice: password
recovery (the server emailed a link to a path the router did not parse), star and mute,
leave, rename and set-topic, the member list, and the Threads view. All are built now,
and **Later** — the one Slack habit with no server either — was built end to end. The
lesson is in the traps list below: this codebase's characteristic bug is a feature that
is complete apart from the way in, and it is invisible from the server side.

Milestone 16 (external apps) shipped and now has a working admin Apps console. The
agentic workspace slice is also in place: thread summaries, human/agent tasks, durable
offline outbox replay, and multilingual message translation are all implemented.

**Milestone 17 (blocks) has shipped** — seven types, `BlockRenderer.tsx`, and
`/api/interactions` checking the `actionId` against the *stored* blocks. This paragraph
said it was still the next seam for long enough that a `/init` pass read it back as fact
and had to check the code to find out otherwise; see the note under "Open questions"
about the unbuilt image, which failed the same way. The roadmap in `progress.md` had it
under Done the whole time.

**Milestone 19 has shipped, both halves.** `POST /api/commands` with six built-ins and a
composer that autocompletes them, and apps may now declare `commands` in their manifest:
a unique index holds the name, dispatch is one signed request with a 3-second budget, and
an app that needs longer answers later through a signed `responseUrl`.

**Multi-workspace shipped.** One server can hold several workspaces; a person is several
user rows, one per workspace, and the switcher hangs off the workspace name in the corner.
`instance_admins` is the real instance-level role that `owner` had been standing in for.
Two bugs that one workspace had kept unreachable came out with it — see the first two
traps below.

**The consoles were split by whose job they are.** `/workspace` runs one workspace —
members, invitations, channels, apps and agents, webhooks, general, appearance. `/admin`
runs the server — accounts, workspaces, health, audit, feedback. Five sections moved out
of `/admin`, which had meant inviting a colleague started in a console named after the
machine. Every old URL redirects, detail ids included. The instance pages only pay off
once a server holds more than one workspace, and today it holds exactly one — see
`progress.md` under Next for what multi-workspace actually needs.

Before those, a smaller gap closed:
**emoji**. The server had shipped `custom_emoji` since the beginning and sent it on every
bootstrap; the client dropped the field on the floor, had no picker, and offered three
hardcoded reactions. There is now `lib/emoji.ts` (a curated set, no new dependency), an
`EmojiPicker` used by both the composer and the reaction toolbar, and `:name:` rendering
in message bodies. A custom emoji beats a built-in one on a name collision, and a body
supplies only a *name* — never a URL — so a message cannot aim an `<img>` anywhere.

## Recent changes

- **AG-UI** — an app may declare `aguiUrl` and answer a mention with no webhook handler
  and no bot token. Blob is the client and the agent is the server, because that is the
  direction every agent framework already ships; see ADR 0011, which also records why an
  answer is buffered and written once rather than streamed into an edit.
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

- **This codebase's characteristic bug is a feature complete apart from its entrance,
  and the server cannot see it.** It has happened five times now: custom emoji (table,
  bootstrap field and picker, no way to add one), pins (route and typed client method,
  no viewer), password recovery (tokens minted, hashed, rate-limited and *emailed* to
  `/reset/<token>` — a path `parseRoute` did not match, so the link opened the app and
  did nothing), star and mute (`notify_level` honoured by `notify.decide`, `is_starred`
  *sorted on* by the sidebar, nothing writing either), and the Threads view (whose
  service docstring reads "the sidebar's Threads view"). Every one had green tests: the
  server was right in all five. The cheap check is a scan for exported client methods
  with no call site — `api.channels.setMembership`, `addMembers`, `archive`, `leave`,
  `update`, `api.messages.threads`, `auth.forgotPassword` and `resetPassword` were all
  dead at once. Do it after any milestone that lands a batch of routes.
- **A URL the server builds and the client parses is a contract with no type.**
  `routers/auth.py` composes `f"{PUBLIC_URL}/reset/{token}"` and `features/auth/tokens.ts`
  matches `/^\/reset\/(.+)$/`. Nothing connects them, so a change to either fails no test
  anywhere and breaks every reset email already in an inbox. Both sides now assert the
  shape — `test_password_reset.py` and `AuthScreen.test.tsx` — which is the same argument
  `test_protocol_parity.py` makes about event names.
- **`store.openChannel` deliberately does not navigate, so every user-initiated open
  must.** It is also what the shell calls on arrival to pick a channel to start on, and
  navigating there would discard a deep link to `/search`. The sidebar and the search
  results both omitted it, so clicking a channel from another view loaded it behind a
  screen that stayed put and the click appeared to do nothing. `lib/navigation.ts`
  ::`showChannel` is the one that navigates; use it for anything a person clicked.
- **A menu that owns a dialog cannot dismiss on every click.** `ChannelMenu` renders its
  confirm dialogs beside itself, so the workspace menu's "any click closes" contract
  would unmount the menu, and the dialog with it, on the click that asked for one. Use
  PinnedPanel's contract — clicks outside only, by `ref.contains` — and suspend it while
  a dialog is up, since every click in the dialog is "outside" by that test.

- **Anything that finds a row by id must also check the workspace.**
  `assert_channel_access` looked a channel up by id alone and let `is_public` grant the
  read, so once a server held two workspaces any account could read another workspace's
  public channels by id. The fix joins `users` on `workspace_id` *inside* the query
  rather than taking it as a parameter, because a parameter is something a call site can
  forget. Signup had the mirror of it: it read `workspaces ORDER BY created_at LIMIT 1`
  and joined people to the oldest workspace whatever their invitation said, even though
  the invite row had carried `workspace_id` all along. Both were unreachable while there
  was one workspace, which is exactly why neither was noticed.
- **One email is one person, with one password, across every workspace.** Under Slack's
  model a person is several `users` rows. A reset must write to all of them, a new
  workspace must copy the hash rather than prompt, and `login` must ORDER BY or the
  planner decides which workspace someone lands in. See `services/workspaces`.
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
- **`host.docker.internal` is a host address, so it lands in the INPUT chain.** On the
  production host that chain has policy DROP, and 8000 is not in its allow-list, so the
  runner's API times out from inside the container while answering fine from the host.
  Nothing logs a refusal — the call just hangs until the deploy timeout. The rule that
  permits it is owned by `blob-coolify-api-fw.service` on the host, which derives the
  bridge and subnet from the Coolify resource UUID and re-adds the rule after boot.
- **Never run `plesk ext firewall --apply` on a host that also runs Docker.** Plesk
  regenerates its rules with `iptables -F FORWARD` and `iptables -t nat -F`, which flushes
  Docker's DNAT, MASQUERADE and DOCKER-USER rules and drops networking for *every*
  container on the machine until dockerd is restarted. Adding a firewall rule through the
  supported tool is far more destructive than adding one by hand; a single additive
  `-I INPUT` touches nothing else. This is also why the rule needs a systemd unit: the
  Plesk unit rebuilds INPUT from its own database at every boot.
- **AG-UI's wire type values are SCREAMING_SNAKE, not the PascalCase in its docs.** The
  published reference heads each section `TextMessageStart`, because that is the
  TypeScript *interface* name; the discriminator on the wire is `TEXT_MESSAGE_START`.
  Field names are camelCase in every SDK including the Python one, which declares
  `message_id` and serialises `messageId`. Matching the docs' headings parses nothing at
  all and fails silently — a test pins it. `state`, `tools` and `forwardedProps` are also
  *required* keys in `RunAgentInput`, so omitting them is a 422 from any FastAPI-hosted
  agent, which reads like the agent being down.
- **Coolify's lifecycle verbs are POST; its read verbs are GET.** `stop`, `start` and
  `restart` answer a GET with `405 {"message":"This endpoint has changed to a POST
  request."}`, while `GET /applications/{uuid}` and `.../logs` are correct as GETs. The
  asymmetry is not guessable and is pinned by `tests/test_agent_runner_api.py`.
- **Policy that its subject can edit is not policy.** `workspace_settings` is a JSONB
  blob a *workspace admin* writes through `PATCH /api/admin/settings`. Anything limiting
  what a workspace may do belongs in `workspace_policies`, which only instance admins can
  reach. Putting a limit in the first table means the person it limits can lift it.
- **An allowlist by slug controls nothing.** A manifest's `slug` is chosen by whoever
  registers the app and is only format-checked, so "only these app names may be
  installed" is bypassed by picking a name on the list. Identity that cannot be spoofed
  is a repository URL; everything else is a capability question, not an identity one.
- **Two switches gate hosting and private endpoints, and a test that sets one is testing
  the wrong refusal.** The environment flag is the ceiling and the workspace's policy row
  is the floor. `tests/helpers.py::allow_policy` opens the row; without it a test that
  monkeypatches `AGENT_RUNNER` or `AGENT_ALLOW_PRIVATE_ENDPOINTS` now gets a
  `policy_forbidden` it did not mean to assert.
- **Subscribe before you publish, on any Redis request/response pair.** An agent can
  answer a socket run in single-digit milliseconds. Publish the request first and its
  opening events are broadcast to a channel nobody has subscribed to yet — the run then
  hangs until its deadline and is reported as a timeout, having actually succeeded. The
  ordering in `gateway.stream_events` is the fix and the reason it is not three lines.
- **Redis pub/sub is fan-out, so "the holder" can be two processes.** An agent
  reconnecting to a second app process while the first still believes it holds the socket
  means a run published once is delivered twice, answered twice, and posted twice. Claim
  the run id with `SET NX` before acting on it — the same claim `jobs/agui.py` takes on a
  message before answering it.
- **Never iterate a task set while cancelling it if a done-callback discards from it.**
  `AgentConnection` kept its background tasks in a set and had each one discard itself on
  completion; `__aexit__` looped over that live set cancelling, which mutated it mid-loop,
  and the `gather` that followed awaited only what survived. The tasks outlived the
  connection. On the test suite's shared event loop they ran on into the *next* test and
  interleaved with its `TRUNCATE`, so the symptom was foreign-key violations during
  fixture setup in files that have nothing to do with sockets — and it moved between runs.
  Snapshot the set before cancelling, and gather the snapshot.
