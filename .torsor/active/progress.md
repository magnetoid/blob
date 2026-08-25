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

- **Socket agents — an agent that dials in** — a fourth runtime for the case with no
  address at all: the agent on somebody's laptop, behind NAT. It opens a WebSocket to
  `/ws/agent`, authenticates with its bot token and holds it; runs go down that pipe and
  AG-UI events come back up. ADR 0011's "Blob is the client" is qualified, not overturned
  — the agent still answers runs it did not start, and the same `Fold` reads the same
  events, because `plugins/agui.py` is a pure function precisely so a second transport
  costs a reader and no semantics. Connecting *is* importing: the agent announces its
  name and description on the way in. Scopes are not self-declared — `hello` carries
  identity only, or the consent screen would be decorative.

  The hard part is that the process holding the socket is not the process running the
  job: mentions are handled by the worker, sockets by an API process, so every run
  crosses through Redis the way `hub.py` does it. Two traps came out of that and both are
  tested. Pub/sub is fan-out, so a run can reach two holders and be answered twice — the
  holder claims the run id with `SET NX` first. And subscribing has to happen *before*
  publishing, or an agent that answers in single-digit milliseconds sends its opening
  events to a channel nobody is listening on, and the run appears to hang and then time
  out having actually succeeded.

  Found a real bug writing the tests, and it was mine: `AgentConnection.__aexit__`
  iterated the live task set while cancelling, and the done-callback discards from that
  same set — so the `gather` awaited whatever was left and returned early. Tasks outlived
  their connection and, on the suite's shared event loop, ran on into the next test,
  where they interleaved with its `TRUNCATE` and surfaced as foreign-key violations in
  fixtures that had nothing to do with sockets. Snapshot before cancelling.

- **App policy — the operator gets a say** — every app endpoint authorises a *workspace*
  admin, which was the whole story while one workspace was the server. Multi-workspace
  split the workspace admin from the person who owns the hardware and left every
  capability with the former: registering an app, running a repository's code as a
  container on the operator's box, holding a socket into this process. `workspace_policies`
  is the say — capability limits per workspace, not a catalogue of approved apps.

  Capabilities rather than an allowlist because an allowlist by *name* controls nothing:
  an external app is a URL and its slug is chosen by whoever registers it, so allowlisting
  `acme-deploy` just means the next person names their app `acme-deploy`. What differs in
  risk is what an app can do to the box.

  Deliberately not a field in `workspace_settings`: that is a JSONB blob a workspace admin
  edits, and policy its own subject can edit is not policy. Only instance admins have a
  route to this table.

  Two composition rules, both tested. **The environment is the ceiling** — `AGENT_RUNNER`
  and `AGENT_ALLOW_PRIVATE_ENDPOINTS` still decide what the server can do at all, and a
  policy row narrows that and can never widen it. **No row means the column defaults**,
  which are closed for the two capabilities that reach the host; migration 0013 seeds the
  workspaces that already existed as permissive, because an upgrade that quietly revokes
  what they had yesterday reads as a bug rather than a policy.

  One subtlety worth keeping: the hosting guard reads the *stored* policy, not the
  effective one. The environment ceiling for hosting is enforced downstream by
  `current_runner`, which refuses with `agent_hosting_disabled` and says to configure
  AGENT_RUNNER — and shadowing that with "ask an administrator" is the wrong advice when
  the administrator is the person reading it.

- **Two features that were complete apart from their entrance** — both the same shape as
  the emoji bug earlier in this project, where the server had shipped and the client
  dropped the field.

  **Pins had no viewer.** The message menu has had Pin since blocks landed, the server has
  `GET /api/channels/:id/pins`, and `api.channels.pins()` sat in the client unused — so a
  pinned message could be pinned and then never found again, which is worse than not
  offering the action. There is now a Pinned button in the channel header. Fetched on
  open rather than on channel switch: pins are read rarely, a request per switch is a real
  cost for a list most people look at once a week, and fetching on open means there is no
  cache to invalidate when somebody pins something. Jumping scrolls to the row via a
  `data-message-id` attribute — an attribute rather than an `id`, because the same message
  renders in the list and in a thread at once.

  **Custom emoji could not be added.** The `custom_emoji` table, the bootstrap payload,
  the file route and the picker all existed; there was no route to create one, so
  `:party-parrot:` could be referenced by anyone and created by nobody. Uploads reuse the
  ordinary attachment flow — same ticket, same presigned PUT, same rate limit — and the
  new endpoint only names the result. The name pattern is deliberately the same one
  `markdown.tsx` matches, or an admin could add an emoji no message is able to reference.

- **The missing entrances, swept** — a scan for typed client methods with no call site
  turned up eight at once, and every one of them was a finished server feature nobody
  could reach. They are grouped here because the *pattern* is the finding; see the first
  trap in `context.md`.

  **Password recovery was the serious one.** The server mints a reset token, hashes it,
  rate-limits the request, answers an unknown address exactly the way it answers a known
  one so the endpoint cannot enumerate accounts, and emails a link to
  `PUBLIC_URL/reset/<token>`. `parseRoute` had no `/reset/` case, so the link fell
  through to the conversation view and the token was discarded in silence: somebody who
  forgot their password was locked out of a self-hosted workspace permanently, holding an
  email that appeared to be broken. There was also no test of the reset half —
  `test_password_reset_signs_out_every_session` signed somebody up and asserted only that
  a forgotten address answers 200. A reset link now outranks a live session, because
  resetting deletes every session the address holds and the person following the link may
  still have a valid cookie in that tab.

  **The channel had no controls.** `channel_members` has carried `notify_level` and
  `is_starred` since the baseline; `notify.decide` honours the first and the sidebar
  *sorts* by the second — so starred channels floated to the top of a list in which
  nothing could star one. Leaving was reachable by typing `/leave`, a topic by `/topic`,
  and the Members button was a count that did nothing when pressed. All of it now hangs
  off the channel name, where a hand coming from Slack reaches.

  **Threads.** `threads_for_user` joins `thread_subscriptions`, honours `muted` and
  orders by `last_reply_at`; its docstring says "the sidebar's Threads view". There was
  none. It sits above Channels and answers ⌘⇧T, both Slack's.

- **Later** — the one Slack habit with no server side either, so this is a whole slice:
  migration 0014, two routes, a boot field, a view. Pinning is the channel's memory and
  is visible to everybody; this is one person's and visible to nobody, which is the whole
  distinction. The primary key is (user_id, message_id), so saving twice is settled by
  `ON CONFLICT DO NOTHING` rather than by a read two taps could both pass. `list_saved`
  joins `channel_members` exactly as `search` does, and that join is the point: a row in
  `saved_items` is a bookmark, never a grant, so leaving a channel takes its messages out
  of your list. The boot payload carries ids only — the menu needs to know which of two
  labels to show, and a per-user flag on `Message` would mean threading a user id through
  the select every broadcast is built from.

- **What's new, and the errors page** — two things the console could not say.

  **What's new** fills the account-menu row that had said "Update — Soon" since the menu
  was written. Shipped *with the build* rather than stored in a table: Blob deploys
  continuously from main, so the bundle somebody is running is the release, and notes
  compiled into it cannot describe a version they are not looking at. Identified by date,
  not semver — every package still says 0.1.0 and nothing has ever been tagged, so
  numbering the last four weeks 0.2 through 0.5 after the fact would be inventing a
  history. The guarded invariant is the order: `LATEST_RELEASE` is `RELEASES[0]` and the
  unseen check is a string comparison against its date, so an entry appended at the bottom
  would silently disable the marker and show the newest update last.

  **Errors and logs** is the instance console's answer to "something happened". A capped
  Redis list of WARNING and above, written by every process, read newest-first with the
  traceback and the endpoint. Gated on `instance_admins` rather than workspace admin,
  because a traceback is about the machine and can name a channel in a workspace the
  reader is not in. Clearing it is audited — the one action there that destroys evidence.
  Two traps came out of it and both are in `context.md`: a diagnostics sink must not share
  a connection pool with anything that matters, and a handler that stores records over the
  network can eat itself.

- **A workspace-isolation audit, and what it found** — prompted by the `to_all` leak: if
  one broadcast helper could be wrong behind a docstring asserting the opposite, there was
  no reason to think it was the only one. Five boundary classes swept, every candidate
  attacked by a skeptic that defaulted to refuted.

  **Three confirmed.** `add_members` accepted `users` rows from any workspace — a global
  primary key satisfied the foreign key, and the after-commit broadcast then subscribed
  that person's sockets to a *private* channel, permanently, since `leave` 404s them and
  no admin remove-member route exists. `presence.sub` watched any id off the wire.
  `/api/admin/health` reported server-wide totals to a workspace admin. All three fixed
  with the constraint inside the statement; the traps are in `context.md`.

  **What it found sound is worth as much:** every REST read path, `search`, the files
  route, the bot API, plugin delivery and the notification worker all carry the boundary
  in the query rather than in a parameter.

  Verified by reverting: six of the seven new tests fail without the fixes, and the
  seventh is the no-regression case. One only discriminated after a fix of its own —
  `receive_until` discards what it passes over, so waiting for a presence frame *after*
  consuming through the pong swallowed the frame being asserted about. A socket test that
  waits for absence has to collect, not skip.

- **Leaving a message unread, and a log of what agents did** — two things people asked of
  a system that could not answer either. `/read` is a ratchet, so unread is its own verb;
  the client half is `suppressReadFor`, because auto-read would otherwise undo it on the
  next arriving message.

  `agent_runs` is the larger one. A run left no trace but `plugins.last_error`, which the
  next failure overwrote — so "I mentioned the agent and nothing happened, why?" had no
  answer, and failed, finished-quietly and never-started were indistinguishable from
  outside. Four statuses because the code already produces four outcomes, and `interrupted`
  is the one an operator can act on: it means the agent is waiting for a person, not that
  it broke. The row is written *before* the agent is called, since a run that never returns
  is exactly the case with nothing else to show for it; a daily sweep closes those and
  enforces retention, because every mention writes a row and nothing else removes one. Two
  short transactions around the network call, never one held across it. The event stream is
  deliberately not stored — the posts are already messages with ids, and keeping the rest
  would make this a transcript store to answer what the counts answer.

- **Blob got an agent of its own** — the gap the plumbing hid. Blob had spoken AG-UI as
  the *client* the whole time and had no model anywhere: `services/agentic.py` summarises
  threads with regex, and every agent was somebody else's container holding somebody
  else's key. So a fresh workspace had no agent at all, and "agent-native" described the
  architecture rather than the product.

  A fourth runtime, `builtin`, which *is* an AG-UI server that never leaves the process.
  It yields the same SCREAMING_SNAKE events an external agent sends, so nothing downstream
  changed — same `Fold`, same 12k split, same ten-message cap, same `agent_runs` row, same
  real `users` bot. The third transport cost a dozen lines, which is what `plugins/agui.py`
  being a pure function of events bought.

  It is a plugin rather than a special case: three scopes, disableable, and a manifest off
  the wire is *refused* if it claims the runtime — that runtime spends the server's key
  rather than the caller's, so it is a door question, not a scope question. Seeded at
  founding and reconciled at boot; nothing at all is seeded when no model is configured.

## In progress

Nothing. 609 backend tests pass with storage up and 218 pass in the browser; ruff, mypy,
tsc, `alembic check` and `torsor guard` are clean. Two of those 591 skip when no bucket
is running (the MinIO-backed attachment and snapshot ones — green while proving nothing,
so bring storage up before trusting them). Counts are worth re-measuring rather than
trusting: this line read "274 and 17" for several milestones after both had moved, and
"467 and 106" when the browser suite had already reached 142.

## Next

### Still short of Slack, measured against the code rather than the roadmap

Each of these was checked against the source, not assumed. None has a server side, so
none is an entrance problem — they are genuinely unbuilt.

- ~~**A message has no permalink.**~~ **Done.** `/m/<id>`, a Copy link action, and
  `GET /api/messages/{id}` — the missing verb, needed because a link carries an id and
  nothing else and because a thread reply is never in channel history.
- **`also_in_channel` is dormant.** Every send path writes it, it is stored and
  serialised onto `Message`, and *no query reads it and no component branches on it*. The
  client never sets it true, so nothing is broken today; a reply sent with it would appear
  live and vanish on reload. Either wire it into `history`'s filter or delete the column.
- ~~**Mark as unread.**~~ **Done.** `POST /api/channels/:id/unread`, its own verb
  because `/read` moves the cursor with `GREATEST(...)` and would have accepted an earlier
  id and silently done nothing. The client half was the real work: auto-read is aggressive
  by design, so `suppressReadFor` holds until you next open a channel.
- **Scheduled send** and **channel bookmarks** — both still absent end to end. These are
  what is left of Slack parity, and both are thin.
- ~~**User groups (`@team`)**~~ **Done**, and it was the one with real depth. A handle is
  not a display name, so `workspace_handles` gives people and groups one namespace to
  collide in; `parse_mentions` returns typed targets; `notify.decide` learned that a group
  mention is neither a person nor an `@channel`.
- **Somebody's status is set in Preferences and read almost nowhere.** `statusEmoji` and
  `statusText` have been on `User` and settable the whole time; until the member list
  landed, no screen displayed either. The message row and the sidebar still do not.

## Next (from the build plan)

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
