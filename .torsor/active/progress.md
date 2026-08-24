---
type: progress
status: active
tags: [active]
---

# Progress

Roadmap and milestone numbering come from `TEAM-CHAT-BUILD-PLAN.md`.

## Done

- **1–9 · Python port** — schema, auth, channels, messages, threads, search, realtime,
  jobs, cutover. Existing argon2 password hashes carried over untouched, so nobody reset
  a password; the dev database was adopted with `alembic stamp 0001` rather than rebuilt.
  **Milestone 8 is only half done**: `pnpm openapi` dumps the spec and ruff/mypy are in
  `pnpm check`, but the generated TS types, the `check:contract` diff and the protocol
  parity test were never built. See "Gaps" below.
- **10 · `apps/server` deleted** — one milestone past the cutover, as planned.
- **11–13 · Superadmin console** — `owner` became a real role (exactly one, cannot
  self-demote or be deactivated). People, invitations, channels, audit log, settings,
  health, webhooks.
- **14–15 · Themes** — four presets, token allowlist plus colour grammar, admin editor
  previewing on the live window, pre-hydration script killing the light flash.
- **16 · External apps** — manifest, SSRF-guarded registration, bots as real users,
  `/api/v1/` callback API, signed delivery, transactional outbox, admin management API.
- **Deployment** — one image, one origin, Coolify compose, boot migrations under an
  advisory lock.
- **Routing** — the four views and the seven admin sections are real paths, so a screen
  can be linked and reloaded into. Hand-rolled: four views and no nested layouts did not
  justify a fourth runtime dependency. Administration also gained the labelled way in
  that Slack has, behind the workspace name.
- **File uploads** — attach, drag-and-drop and paste-a-screenshot. Only the client was
  missing; the ticket/PUT/complete flow and `attachmentIds` on send already existed. The
  bucket is created on first upload rather than by an init container, because a container
  that exits makes `docker compose up --wait` report failure even on exit 0.
- **Feedback tickets** — filed by anyone from the user menu, read by admins only, since a
  page snapshot can contain a private channel. Carries the console log and the page as
  the reporter saw it, both captured when the dialog opens rather than on submit.
- **Protocol parity** — `blob_api.realtime.protocol` declares the event vocabulary and
  the timings once, and a test parses `protocol.ts` and compares. The plan called for a
  Pydantic mirror; there was none — event names were string literals scattered through
  routers and services, and the timings lived in three modules. Each assertion was proved
  by breaking it deliberately: a renamed event, a drifted heartbeat, and a declaration
  nothing sends.
- **17 · Blocks** — seven types, closed deliberately. `body` stays the fallback and the
  only thing search reads. An interaction is accepted only when its `actionId` appears in
  the blocks stored on that message, which is the entire security story: a client cannot
  invent an action and an app cannot receive an id it never published. Found a real bug
  while wiring it — `plugins.events.emit` filtered `runtime = 'external'`, so a container
  agent would have subscribed to events and received none.
- **Agents from a repository** — `blob-app.json` read from GitHub, scopes approved, then
  deployed as a container by a runner that is not this process. See ADR 0010. Hosting is
  off unless `AGENT_RUNNER` is set, and the Coolify calls have not yet been exercised
  against a live deploy — only against a stub. The console shows a hosted agent's status,
  its logs, and buttons to redeploy or stop it; status is fetched when a row is opened
  rather than polled, because a list of agents polling a runner is a lot of requests to
  answer a question nobody is looking at.

- **Emoji** — a picker for the composer and the reaction toolbar, `:name:` in message
  bodies, and the workspace's own emoji finally reachable. The server had been sending
  `customEmoji` on every bootstrap since the beginning and the client discarded the
  field; reactions were three hardcoded characters, under a comment promising a picker
  that did not exist. The set is curated in `lib/emoji.ts` rather than pulled from a
  package — a full Unicode table is megabytes for a long tail nobody reaches, and the
  runtime dependencies stay countable. Custom beats built-in on a name collision, and a
  body supplies a name rather than a URL, so no message can aim an `<img>` of its own.

- **19 · Slash commands, built-in half** — `POST /api/commands`, one namespace, one
  place to say no. `/help`, `/shrug`, `/me`, `/topic`, `/leave`, `/away`. The service
  decides what a command *did* and returns it; the router broadcasts after commit, so
  persist-then-broadcast survives a second write path. An ephemeral reply rides back on
  the same HTTP call rather than over the socket — its only reader is already holding the
  response, so an event would be a delivery path with one subscriber. An unknown command
  answers softly instead of 400: a typo must not be a red banner, and once apps register
  commands it may simply be one that exists in a colleague's workspace. The command list
  ships on bootstrap, so an app-provided command will reach the composer's autocomplete
  without the client learning anything.

- **19 · Slash commands, the app half** — a manifest may declare `commands`, and the
  name is held by a unique index on (workspace_id, name) rather than a check: two apps
  installing `/deploy` at the same moment both pass any check that could be written, and
  only one can win an index. The loser is told which name it lost. Dispatch asks the app
  over one signed request with a 3-second budget — Slack's number, because every app
  author has already been told it — and an app that needs longer answers `202` and posts
  to a `responseUrl` when it is ready. That URL is a signed token, not a row: what it
  carries is small and fixed, it is used a handful of times within minutes, and a table
  would need sweeping. The network call happens with **no transaction open**, because
  holding one across somebody else's server is how a slow app becomes a database problem.
  An app is only asked in channels its bot was added to.

- **Two consoles, split by whose job it is** — `/workspace` is running one workspace:
  members, invitations, channels, apps and agents, webhooks, general, appearance.
  `/admin` is running the server: every account on it, every workspace on it, health,
  audit, feedback. Members, invitations, channels, apps and webhooks used to live under
  `/admin`, which meant inviting a colleague started by opening a console named after the
  machine. Every moved URL redirects, detail ids included, because they were linkable and
  somebody has one in a message. `registry.test.ts` now guards both lists and asserts
  they share no id — that shared namespace is how the two drifted into one console
  before.

- **Multi-workspace** — one server, several workspaces, Slack's model. The schema already
  allowed it: `users` is unique on (workspace_id, email), never on email, so **a person is
  several user rows** — one per workspace — and every tuned query keeps meaning exactly
  what it meant. Switching is signing in as the other row, done for you. `instance_admins`
  is keyed on email because it is a fact about a *person*, not a role inside one
  workspace; `owner` had been standing in for it and would have been the wrong answer the
  moment there were two workspaces to own.

  The rule the whole thing rests on is **one email, one password, everywhere**: a reset
  writes to every row that address holds, a second workspace copies the hash across rather
  than prompting, and `login` orders its lookup so a bare sign-in always lands in the same
  place. Break it anywhere and someone can sign into one of their workspaces and not
  another, with nothing on screen to explain it.

  Enabling it surfaced two bugs that one workspace had kept unreachable:

  * **`assert_channel_access` never checked the workspace.** It found a channel by id
    alone, and `is_public` then granted the read — so any account on the server could read
    any other workspace's public channels by id. Fixed by joining `users` on
    `workspace_id` inside the query rather than adding a parameter every call site would
    have to remember, which is the same reasoning `transaction()` uses for
    persist-then-broadcast.
  * **Signup ignored the invitation's workspace**, reading `workspaces ORDER BY created_at
    LIMIT 1` and joining people to the oldest one whatever they had been invited to. The
    invite row had carried `workspace_id` since the beginning; nothing read it.

## In progress

Nothing. 425 backend tests pass and 2 skip (the MinIO-backed attachment and snapshot
ones, which skip when no bucket is up — green while proving nothing, so bring storage up
before trusting them); 106 pass in the browser. ruff, mypy, tsc and `alembic check` are
clean. Counts are worth re-measuring rather than trusting: this line read "274 and 17"
for several milestones after both had moved.

## Next

- **Multi-workspace, the rest** — what shipped is creating, listing, switching and
  keeping workspaces apart. Still missing: naming and deleting a workspace from the
  instance console, moving a person between workspaces, and inviting someone who already
  has an account elsewhere on the server (today they sign up again and the hash is copied
  across, which is right, but the invite screen does not know them). Per-workspace
  quotas and suspension are the other half of what an instance operator will want.
- **App catalogue** — which apps a workspace is allowed to install. Listed in the
  instance nav as planned; there is no policy table behind it yet.
- **Membership commands** — `/join`, `/invite` are not built. They need the connection
  subscribe/unsubscribe dance that `routers/channels.py` does inline, and duplicating it
  in the command service would be the second copy of logic that is already subtle. The
  fix is to lift it into `services/channels.py` first; `/leave` is implemented here only
  because leaving is the one direction that is a single unsubscribe.
- **18 · Local plugin runtime** — importlib discovery under `PLUGINS_DIR`, decorator API,
  per-plugin KV, circuit breaker, boot quarantine. Less urgent than it was: an agent from
  a repository now runs as a container, which is what people actually wanted this for,
  without the in-process trust ADR 0009 refuses.
- **20 · Plugin admin console** — largely built as the Apps section; what remains is the
  deployment surface above.

## Gaps in what already ships

Not features — places where working code is unprotected.

- **No generated types or contract diff.** Milestone 8 planned `openapi-typescript` output
  under "packages/shared/src/generated/" plus a `check:contract` script. Neither exists,
  so the hand-written types and the real API can diverge unnoticed. (Path in quotes, not
  backticks — it is a planned artifact, and the staleness check rightly flags a backticked
  path that is not on disk.)
- **Thin frontend tests.** Better than it was — the outbox, the router, emoji resolution,
  shortcode rendering and command parsing are covered, 11 files in all — but `vitest` still
  runs with `--passWithNoTests`, and the theme token logic and the socket reconnect path
  remain the two worth covering next. Nothing covers a component's behaviour beyond
  `MessageList`, `AdminNav` and `ConfirmDialog`; the emoji picker and the command
  autocomplete are tested through their logic modules rather than through the UI.

## Deferred
- **Huddles** and the **AI layer** — see the build plan.

## Blocked

Nothing. The image build was blocked on local disk; CI builds it and boots the whole
production stack on every push, which is a better check than doing it by hand ever was.
