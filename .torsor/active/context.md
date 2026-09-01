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
- **The workspace boundary is only ever safe when it is *inside the statement*.** Four
  bugs of one shape have now been found here, and each was invisible with one workspace
  and silent with several. `assert_channel_access` found a channel by id alone.
  `hub.to_all` sent to every connection on the process behind a docstring that said
  "workspace-wide". `services/channels.add_members` was `INSERT ... SELECT
  unnest(:user_ids)` with two independent foreign keys and no composite constraint, so a
  `users` row from another workspace satisfied the FK and could be planted in a private
  channel. `/api/admin/health` counted every message on the server for any *workspace*
  admin. The rule that would have prevented all four: derive the boundary from a row the
  statement already touches — join `users` to `channels` on `workspace_id` — rather than
  taking it as a parameter, which is something a call site can forget. `POST /api/dms`
  had the check `add_members` was missing, in the same file, the whole time.
- **A fix to one branch of a dispatcher is not a fix.** Both the `to_all` and the
  `assert_channel_access` repairs were correct and neither was generalised: the workspace
  filter went onto one branch of `_deliver_local` and stopped, so `_by_channel` and
  `_by_presence_sub` delivery still consulted no workspace at all. When fixing a boundary
  bug, check every sibling path that reaches the same registry.
- **Any list of ids arriving from a client is a query, not a value.** `presence.sub`
  took `userIds` off the wire, cast each to `str`, truncated at 500 and watched them —
  live attendance telemetry on named people in other workspaces. Ids are not secret here:
  they ride in message payloads and outlive being removed from a workspace, so "you would
  have to know the id" is never the defence. Resolve such a list through SQL carrying the
  caller's workspace, and drop what does not survive **silently** — refusing a specific id
  confirms it names somebody.
- **A diagnostics sink must not share a connection pool with anything that matters.**
  `lib/logbuf`'s handler first used `lib.redis.redis`. A logging handler is called from
  anywhere — including from code running on an event loop that is about to close — and a
  redis-py connection belongs to the loop that opened it, so a write scheduled from the
  wrong place leaves a dead connection in the pool. That pool is presence, rate limiting
  and the pub/sub bridge, so the thing that exists to *report* failures was able to cause
  them. It surfaced as `RuntimeError: Event loop is closed` inside `conftest._clean_state`
  two test files later, which is about how much a production instance of this would have
  resembled its cause. Own client, discarded and rebuilt on any error; a test asserts it
  is not the shared one. The same reasoning applies to anything else added on the side of
  the request path.
- **A logging handler that stores records over the network can eat itself.** Storing a
  record can fail; the failure logs; that record is stored; it fails. `logbuf` drops
  records from `redis.*` and its own logger, and its writer never logs at all — not even
  about being unable to write. There is also a hard in-flight cap, because the failure
  mode is unbounded task fan-out and a clever guard is the wrong kind of defence there.
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
- **A patch helper that reads the real class at call time cannot be applied twice.**
  `tests/test_agui.py::route_agent_to` captures `real = httpx.AsyncClient` when it runs,
  and `jobs.agui.httpx` is the *same module object* every caller patches. Call it a second
  time and the second fake wraps the first, so the first transport answers both requests —
  a test that asks the agent twice silently gets the first reply for both, and passes.
  Patch once through a mutable slot and swap the slot per call, as `test_agent_runs.py`
  does. Any "patch the module attribute" helper has this shape; the tell is a helper that
  is safe once and wrong twice, which no single-call test can reveal.
- **`/read` is a ratchet on purpose, so rewinding needs its own verb.** The cursor moves
  with `GREATEST(...)`, which means posting an *earlier* message id to it is accepted and
  does nothing — silently. Mark-as-unread is therefore `POST /channels/{id}/unread`
  rather than a smaller value through the same route. The client half is the real problem:
  auto-read is aggressive by design (`openChannel` reads on arrival, and every
  `message.new` in the channel you are looking at reads again), so `suppressReadFor` has
  to hold until you next open a channel, or one arriving message undoes what you asked for
  and nothing says so.
- **Patch a name your module owns, never one it borrows.** The generalisation of the
  `route_agent_to` trap above, and it bites harder. `lib/llm.py` does `import httpx`, and
  so does `tests/helpers.py` — it is one module object, so a fixture that patches
  `llm.httpx.AsyncClient` to inject a fake model transport also replaces the class the
  *test suite's own client* is built from. Every request to the app under test then goes
  to the model's mock. Six tests failed in ways that read as bugs in the feature, and
  nothing pointed at the fixture. Fixture order is what decides whether it happens at all:
  `model` before `client` in the signature means the client is constructed after the
  patch. The fix is a named seam the module owns — `llm.open_client()` — which a test can
  replace with no reach outside the module. Any `monkeypatch.setattr(mod.somelib, ...)`
  has this shape.
- **The worker answers mentions; the app only seeds.** A model key set on the API service
  and not on the worker produces the worst version of the built-in agent: it exists, it is
  mentionable, and it answers every mention with "no model is configured". Both services
  in `docker-compose.prod.yml` carry `LLM_*` for this reason, and the same split applies
  to anything else the agent path will need.
- **Coolify's env API creates duplicate keys, and which one reaches the container is a
  coin flip.** `POST /api/v1/applications/{uuid}/envs` does not upsert — it appends, and
  so does a `PATCH` that does not match. Every key on the janus-agui app had two entries;
  two of them disagreed, and the running container had `OPENROUTER_API_KEY` **empty**
  despite a 73-character value being configured, while `ANTHROPIC_API_KEY` happened to get
  the non-empty twin. Nothing reports this: the app boots, and the agent is simply unable
  to reach a provider it appears to be configured for. Anything Blob builds on top of this
  API must read the list, delete every row for the key by `uuid`, then `POST` once — and
  a later, cleaner probe corrected the first one, so measure before trusting either of
  these paragraphs on a new Coolify version. What actually holds on 4.3.11: **every
  variable has a hidden `is_preview` twin**, so the raw list shows each key twice even on
  a healthy app — reading it without filtering flags every agent as broken, and the first
  probe misread exactly this. One `POST` creates the prod row *and* the preview twin.
  `POST` for a key that exists anywhere is refused with "use PATCH" — so deleting only
  the prod row leaves a preview row that blocks the rewrite. `PATCH /envs` updates prod
  in place *when there is one prod row*; rows written by older Coolify versions exist
  genuinely duplicated within prod (the disagreeing API-key twins were real), and PATCH
  touches one of such a pair. Delete-every-row-then-POST is the one write that lands in
  the same state from any starting shape. `plugins/runner.py:set_env`, and `env()` must
  filter `is_preview` or the console cries wolf on every key.
- **A `docker compose` network declared `external` is not necessarily joined.** The janus
  stack declares `agents: {external: true, name: blob-agents}` and its container is on its
  own Coolify network only — the compose change shipped but nothing redeployed it. So
  `blob-agents` held Blob's app and worker and no agent at all, and the container-to-
  container path everyone assumed was available did not exist. Check
  `docker network inspect blob-agents` rather than the compose file.
- **Blob's SSH key for the agent shell is confined by a forced command, not by trust.**
  `authorized_keys` pins it to `/usr/local/bin/blob-agent-exec`, so sshd runs that whatever
  the client asks for: the client cannot choose a command, only supply a deployment uuid.
  The wrapper refuses anything that is not a 24-character id, refuses Blob's own uuid so
  the key can never reach the database holding every message, refuses a deployment with
  more than one container rather than guessing, and logs every session to syslog. That is
  how ADR 0010's reasoning survives being overruled — the blast radius of the credential
  is one `docker exec` into one agent container.
- **A hosted AG-UI agent could never be mentioned, and nothing said so.** `listeners_for`
  admits a plugin only when `agui_url IS NOT NULL` or its runtime dials in. `agui_url` came
  solely from a manifest, and a manifest is written before the agent has an address —
  the runner invents the hostname at deploy time. So the one field deciding whether a
  deployed agent can be spoken to was the one field a deployed agent could never fill in.
  Every mention produced no reply, no error, no `agent_runs` row and no log line. The fix
  is `aguiPath` in the manifest — a path *is* knowable in advance — joined to the base the
  runner reports. When adding a field that gates delivery, check that the runtime which
  needs it most is able to supply it.
- **`deploy` answers before the runner has assigned a hostname; only `status` reads one
  back.** Nothing called `status` except the console rendering the deployment panel, so an
  agent installed over the API and never clicked on had `request_url` NULL forever —
  `lease_due` skips those rows, so its events queued with zero attempts and zero errors.
  A URL that only exists after someone looks at a screen is not a URL.
- **`len()` on a `str` is not a byte count.** The agent socket's `MAX_FRAME_BYTES` check
  was `len(raw)` on decoded text, so a frame of non-ASCII could be several times the cap
  and pass. The socket run path also capped events but not bytes, leaving the real ceiling
  at events times frame size. Both caps exist because an agent can be wrong in either
  direction: many tiny events, or few enormous ones.
- **Runs were addressed by id with no check that the sender owned them.** Any
  authenticated bot could publish AG-UI events into any run id it named — fabricated text
  posted as another agent's reply, or a `RUN_ERROR` to end its run. The only obstacle was
  that a UUIDv7 is unguessable, which is why it had not happened rather than why it could
  not. The claim key was already there and already scoped to one run; it now holds the
  claiming plugin's id instead of `"1"`, and `owns_run` reads it back.
- **Two pytest runs against the same database look exactly like a flaky test suite.**
  `_clean_state` TRUNCATEs before every test, so a second run truncates mid-test in the
  first: foreign-key violations on `sessions` during signup, in fixtures with nothing to do
  with the code under test, moving between files on each run. Before hunting a race in
  application code, run `ps aux | grep pytest`.
- **`instance_admins` was not in the test TRUNCATE.** It is keyed on an email rather than a
  user, so it survived its workspace being deleted and survived the reset — making "who is
  the instance admin?" depend on which file signed up first. Three unrelated tests failed
  purely because new test files changed the alphabetical order. A table that outlives the
  rows it references needs naming in the reset explicitly.

- **The protocol-parity suite also checks emission.** Adding an event name to
  `realtime/protocol.py` + `protocol.ts` is not enough — `test_protocol_parity` greps the
  server source for the literal and fails on "declared but never sent". Write the emitter
  in the same commit as the declaration.
- **The parity parser ends a TS union at the first depth-0 semicolon** — including one
  inside a `/** comment */`. Doc comments inside the `ServerEvent` union must not contain
  `;`.
- **`test_agui.py` imports the `sse` module; a helper named `sse` shadows it** and every
  decoder test fails mysteriously. Suffix test helpers (`sse_frame`) instead.
- **Two pytest processes against one database destroy each other** — `_clean_state`
  TRUNCATEs per module. Never run a file-scoped pytest while the full suite runs; the
  failures look like FK violations and policy refusals, not like a collision.
- **httpx `Timeout(total, read=x)` has no total-run wall for a streaming response** —
  the first positional is connect/write/pool, and steady chunks under the read gap can
  stream forever. The absolute bound must be enforced in the read loop
  (`AGUI_MAX_RUN_SEC`), which is also what run cards rely on.

- **Coolify deploys compose apps from its stored `docker_compose_raw`, not the repo
  file.** The build uses git, the `up` uses a snapshot captured at app creation — so a
  committed change to `docker-compose.prod.yml` ships the new *image* while the stack
  keeps the old service definitions, env lines included. Found when the worker's new
  `COOLIFY_*` env block never arrived. The API refuses to PATCH `docker_compose_raw`;
  the sync is a psql UPDATE on Coolify's own DB (`applications` table, backup first) or
  the UI's reload-compose button. After any compose change: update the snapshot, then
  deploy.

- **`MAX(uuid)` does not exist in Postgres.** There is no max aggregate for the type, so
  "the newest message per channel" is `DISTINCT ON (channel_id) … ORDER BY channel_id,
  id DESC`, which also walks the existing index rather than aggregating the table.
  `GREATEST(uuid, uuid)` *does* work — it needs only the btree comparison — which is why
  `mark_read`'s ratchet has always been fine. Hit while writing mark-all-read.
- **The 46 themeable token names are sliced by index, not looked up.** `TOKEN_GROUPS` in
  `services/themes.py` is `THEMEABLE_TOKENS[0:10]`, `[10:14]`, and so on, so *reordering*
  tokens.css silently regroups the theme editor while every name still validates. Add new
  token families below the colours and never inside them.
- **A custom property's computed value is resolved, not literal.** `getComputedStyle`
  returns `#141614` for `--bg: var(--dark-bg)`, which is what lets the dark palette be
  written once and aliased twice — and what stops `ThemesSection`'s colour-input
  normaliser choking on a `var()`. Verified in a browser before relying on it.
- **`justify-content` and `display` cannot be transitioned; `visibility` can.** The switch
  knob teleported because its position was a flex-alignment flip, and the message hover
  toolbar could not animate at all because it was `display: none`. Reveal with
  opacity + `visibility` (co-transitioned) rather than opacity alone — opacity 0 leaves
  every control clickable and in the tab order, which is the same bug the mobile drawer
  had with a bare `transform`.
- **A vitest worker can time out under load and still report "passed".** `pnpm check`
  exited 1 with `[vitest-worker]: Timeout calling "fetch"` and one test *file* never
  collected, while the summary line said 258 passed. Compare the file count against a
  known-good run before believing a green summary.
- **The virtualizer's spacer is a flex item, and flex items shrink.** `.message-list` was
  made a flex column so a short conversation could sit on the composer; that silently
  crushed `.message-list-viewport` — whose inline height stands in for every unrendered
  message — from 6,711px to 488, so the scrollbar described the window instead of the
  conversation and paging back never triggered. `flex: none` on the spacer. The list test
  did not catch it and cannot: happy-dom does no layout, so it asserts the inline style,
  which was never wrong. Found only by loading 600 real messages into a channel.
- **The `flushSync` warnings from the message list are upstream, and the obvious fix is
  worse than the warning.** Opening a channel logs ~20 `flushSync was called from inside
  a lifecycle method` errors. The stack blames `MessageList`, but that is React's *owner*
  stack, not the call site: capturing a real `Error` stack inside a patched
  `console.error` shows `measureElement → resizeItem → notify → flushSync` inside
  `@tanstack/react-virtual`, invoked from the `ref={virtualizer.measureElement}` callback,
  which React runs during commit. React skips the synchronous flush the same way in
  development and production — only the warning is dev-only — so there is no behavioural
  difference to recover. The library's `useFlushSync: false` escape hatch would apply to
  *scroll*-driven updates too, where the flush does work and prevents blank rows, so
  taking it trades a dev-console annoyance for a user-visible one.
  `useAnimationFrameWithResizeObserver` does not help: it only defers the ResizeObserver
  path, not the ref-callback one. Scroll position was verified correct despite the warning
  (`scrollTop + clientHeight === scrollHeight` on channel open). Leave it.
- **`@` autocomplete matches prefixes, and ranks before it caps.** `includes()` made `@e`
  offer "Devin Cole" and `@ma` offer "Priya Raman"; slicing to six before ranking dropped
  the person being typed out of a list that had room for them. `mentionMatch.ts` holds the
  rule, and its tests were checked against the old implementation — pasted back in — to
  confirm they discriminate. Anything that reorders that list is changing which person
  Enter mentions.
