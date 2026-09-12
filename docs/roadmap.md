# Blob — roadmap

This is the plan from 2026-09-12: six months, simplify first, then features. It replaces
the staged R1–R8 roadmap that lived here (R1–R6 shipped in full; what R7–R8 still owed is
folded into Q2 below) and the original build plan, whose milestones 1–20 are all either
done or recorded as deferred in `.torsor/active/progress.md`. The measured baseline it
opens with is the one every target is stated against; re-measure with the commands under
"Verification" before claiming a target.

## Context

Blob is a self-hosted, agent-native Slack alternative: FastAPI + hand-written SQL on
Postgres, Redis, an arq worker, a React 18 + Vite + zustand client, one image on one
origin, deployed to two production instances on every push to `main`. The last five
weeks shipped 48 commits: meetups, the agent tool loop, MCP for a person's assistant,
chains, work channels, summaries with citations, the Meadow design, DeepSeek.

Three read-only audits (backend, client, 2026 market) and direct measurements on
2026-09-12 found a codebase that is **structurally sound but carrying the weight of that
speed**. The import graph is acyclic, no layer rule is broken, persist-then-broadcast
holds at all 62 broadcast sites (AST-verified), and quality markers are near zero (0
TODO, 0 `console.log`, 2 `any`, 7 `eslint-disable`). What has accumulated instead is
duplication (the same dialog scaffold in 11 files, the membership join at 40 sites,
`OkOut` declared 17 times), dead surface (13 unreferenced CSS families, a zod schema
file with one consumer, four routes nobody calls), two algorithmic hot spots in the
store, a 1.07 MB main bundle because an opt-in feature is not lazy-loaded, and a
fifteen-minute local test run that truncates 28 tables before every one of ~1,430 tests.

The user's three decisions, fixed for this plan:

1. **Simplify first, then features.** Q1 deletes and consolidates; Q2 builds on the
   smaller codebase.
2. **Platform-level changes are in scope when a measurement justifies them**, each with a
   rollback path.
3. **Six months as two quarters**: Q1 = mid-Sep to mid-Dec 2026, Q2 = mid-Dec 2026 to
   mid-Mar 2027, each with milestones.

Intended outcome: by mid-December the same product with fewer lines, a smaller bundle, a
test suite that runs in a third of the time, and one shared component where there were
eleven copies; by mid-March the feature set the 2026 research says a self-hosted,
agent-native team chat needs (export, digest, agent sessions, approvals, MCP GA
alignment), each landing on that cleaner base.

Every slice is one commit on `main` with the gate green. Rollback is `git revert` of
that commit; the platform slices are split into a "bump" commit and an "adopt" commit
so the revert is clean. Effort key: **S** ≤ 2 days, **M** ≤ 1 week, **L** > 1 week.

## Baseline (measured 2026-09-12; these are the numbers Q1 moves)

| Measure | Now | Where it comes from |
|---|---|---|
| Backend source | 39,000 lines (services 11,372 · routers 9,932 · db 4,985 · plugins 4,861 · lib 3,068 · jobs 2,082) | `find apps/api/src -name '*.py' \| xargs wc -l` |
| `text(` in routers | 131 (admin.py 31 · auth.py 21 · users.py 14 · plugins.py 13 · files.py 8) vs 217 in services | grep |
| Functions ≥ 200 lines | 4: `jobs/agui.py:_run_one` 389, `services/messages.py:send` 217, `jobs/agui.py:_run` 210, `routers/commands.py:run_command` 206 | audit |
| Backend tests | 23,309 lines · 99 files · 1,427 collected · **14:54 serially** on the laptop with MinIO down (CI ~9 min) | `uv run pytest -q --durations=25` |
| Client source | 29,381 lines · 140 files (non-test); largest `store.ts` 1,691, `Composer.tsx` 1,238, `api.ts` 1,198, `ThreadPanel.tsx` 817 | wc |
| Client tests | 9,195 lines · 78 files · 602 cases | `pnpm exec vitest run` |
| `styles/app.css` | 7,210 lines · 620 class selectors · 13 unreferenced families (~130 lines) | audit |
| Main JS bundle | **1,071 KB raw**, LiveKit inside it (156 references); only AdminConsole, SettingsConsole, HelpView are lazy | `ls -la apps/web/dist/assets` |
| Inline `style={{` | 241 sites in 60 files (PreferencesSection 26, NotificationsSection 17) | grep |
| Dialog scaffolds | 11 copies of `trapFocus` + `useEscape` + the backdrop block | audit |
| Hand-rolled fetch guards | 17 `let cancelled = false` copies beside a working `lib/useFetch.ts` | audit |
| Hand-written API types | `api.ts` 1,198 lines + `types.ts` 50 exports; `openapi.json` (165 paths, 195 operations, 214 schemas) consumed by nothing in the client | `packages/shared` |
| Docs | 13 stale planning docs (2,883 lines) beside 3 current guides in `docs/`; `TEAM-CHAT-BUILD-PLAN.md` (823) and `ROADMAP-2026.md` at the root | `wc -l docs/*.md` |
| Churn since Aug 1 | app.css 83 commits · api.ts 47 · Workspace.tsx 38 · store.ts 33 · models.py 33 | `git log --name-only` |

## Ground rules (from CLAUDE.md and the ADRs)

- Hand-tuned SQL stays `text()`. `services/meetups.py` is the one ORM holdout and W5
  brings it in line. No query layer is introduced anywhere.
- Persist, then broadcast, through `db/engine.transaction()`'s `after` callbacks. Every
  consolidation of broadcast code keeps the closure shape.
- The 44 colour token names in `styles/tokens.css` are a by-index contract with
  `services/themes.py`. Nothing below touches their order.
- `lib/llm.py` keeps exactly three callers. Nothing below adds a fourth.
- Gate: `pnpm check` + `uv run alembic check` + `torsor guard --strict --severity error`.
  One Coolify build at a time.
- "As familiar as Slack": nothing below changes a reflex a Slack user already has.
- UUIDv7 ids, private channels answer 404, no read receipts, fail toward the workspace
  staying up.

## Already done (so nobody re-plans it)

The 2026-08 pass (module splits, run cards, PWA/push, Later, Catch-up, budget meter,
manifest re-consent); roadmap R1–R6; meetups on LiveKit; @Blob reads the workspace
through six MCP tools on the asker's authority; @Blob posts behind
`messages:write.anywhere`; chains (ADR 0013); work channels (ADR 0014); summaries with
citations (ADR 0015); a person's assistant over `/api/mcp` (ADR 0016); DeepSeek;
Meadow on the shell. `hub.to_all` is already gone (0 call sites), so that roadmap
leftover is struck. `routers/mcp.py` is already stateless with `Mcp-Method`/`Mcp-Name`
header checks, so the research's headline MCP implication is already true.

Carried into Q2 from earlier plans: email digest, workspace and per-person export,
server-side drafts, custom sidebar sections, forwarding with a record, Blob as an MCP
client (spike, ADR-gated), a Playwright contract test, Slack import, OIDC, image-group
grid, the free-text answer to an interrupted run, and the console rows `planned` since
the console existed (approvals, storage, import-export; moderation is deleted, see M3).

---

## Q1 — Simplify (mid-Sep → mid-Dec)

### Targets

| Metric | Now | Target | Where the reduction comes from |
|---|---|---|---|
| Backend source lines | 39,000 | ≤ 38,300 | the itemised duplication in W4 (~500) plus dead routes, deps and `forget` (~100); the router→service moves in W5 and the splits in W6 are neutral by design |
| `text(` in routers | 131 | ≤ 50 | admin, auth, users, plugins, files move to services |
| Functions ≥ 200 lines | 4 | 0 | W6 splits along seams already named |
| Local pytest wall time | 14:54 | ≤ 8 min | test-profile argon2 + `pytest-xdist -n 4` (W1) — **6:03 on the first run** |
| Client source lines | 29,381 (29,093 after W3) | ≤ 28,200 | dialog ×11 (~200), fetch ×17 (~150), empty-state ×21 (~120), formatters (~40), `schemas.ts` (~160), dead exports and methods (~30), duplicated state (~100), then W10's generated types (~400) |
| Main chunk (raw) | 1,071 KB | ≤ 600 KB and **0** `livekit` references | LiveKit lazy (W2) — **325 KB after W2**, the meetup view its own 692 KB chunk |
| `style={{` / `let cancelled` / `trapFocus` | 241 / 17 / 11 | ≤ 60 / 0 / 1 | W3, W7 — **after W3: 239 / 3 / 0**; the three left are the bootstrap, the permalink jump, and the thread panel W7 takes apart |
| `app.css` | 7,210 | ≤ 6,700 | 130 dead + backdrop, empty-state and field consolidation; tokens.css untouched |
| `docs/` + root plans | 17 + 2 | 5 + none | W1 |

### W1 (Sep 14–20) · Measure, speed the suite, delete the stale docs — M

- First, the two measurements every later number is stated against, recorded in
  `.torsor/active/progress.md`: `uv run pytest -q --durations=25` and one
  `npx vite-bundle-visualizer` run.
- **Argon2 under test.** `lib/auth.py:31` builds `_hasher` from settings
  (`ARGON2_PROFILE: Literal["default", "fast"]`, `fast` = t=1, m=8 MiB, p=1, honoured
  only when `NODE_ENV=test`); `tests/conftest.py` sets it. Verification reads the
  parameters from the stored PHC string, so production hashes and behaviour do not
  change. `helpers.sign_up` is called 241× and `invite_and_sign_up` 110× from
  function-scoped fixtures; at ~55 ms per default hash that is ~2.5 minutes of pure
  hashing. Test: `test_auth.py` asserts the production profile is argon2's default.
- **`pytest-xdist`.** `helpers.migrate_test_db` targets `blob_test_{PYTEST_XDIST_WORKER}`
  and conftest maps workers gw0–gw3 onto Redis dbs 12–15; `hub.reset_for_tests()` is
  already per-process. Proof: three consecutive green `-n 4` runs. Rollback: drop `-n`.
- Fix the two wrong statements: `conftest.py::_clean_state`'s docstring and CLAUDE.md
  say "before each module"; the fixture is function-scoped and runs before every test.
- **Docs.** `git rm` the 13 planning files in `docs/` (everything except `apps.md`,
  `agent-socket.md`, `agent-terminal.md`, `backup.md`, `roadmap.md`), plus
  `TEAM-CHAT-BUILD-PLAN.md` and `ROADMAP-2026.md`; fold `meetup_functionality.md`'s
  true sentences into README "Meetups"; rewrite `docs/roadmap.md` as this plan (name
  kept so links survive); repoint `.torsor/active/progress.md`'s build-plan reference.
  History keeps the deleted files. Metric: suite minutes.

### W2 (Sep 21–27) · Bundle and dead client weight — S–M

- `app/Workspace.tsx`: `MeetupView` becomes `lazy()` exactly like `AdminConsole`
  (line 33); `manualChunks.react` stays. xterm is already lazy (`AgentTerminal.tsx:60`).
- Delete `escapeIsClaimed` (`lib/useEscape.ts:64`), `isValidZone`
  (`settings/timezones.ts:77`), the 8 uncalled `api.ts` methods (keep
  `api.agentRuns.answer`, a Q2 gap), the 13 unreferenced CSS classes
  (`app.css:941–1075` sidebar-footer/account family, `stagger-4/5`,
  `diff-file/hunk/meta`, `workspace-name`), and drop `export` from the ~40 symbols used
  only in their own module.
- Retire zod: `packages/shared/src/schemas.ts` (162 lines, 27 exports, one consumer)
  becomes a 15-line `limits.ts` holding the channel-name rule and `MESSAGE_MAX_LENGTH`;
  remove `zod` from `packages/shared/package.json`; fix `openapi_dump.py`'s docstring
  pointing at a `generated/` directory that does not exist (W8 creates it).
- Proof: vitest still collects 78 files; `pnpm build` main chunk ≤ 600 KB with zero
  `livekit` references. Metric: main-chunk bytes.

### W3 (Sep 28–Oct 4) · One Dialog, one fetch, one formatter — M

- `components/Dialog.tsx` on native `<dialog>` + `showModal()` (happy-dom 20.11.6
  implements it): `::backdrop` replaces the pasted 14-line backdrop block, native focus
  containment replaces `lib/focusTrap.ts`, the `cancel` event replaces the dialog half of
  `useEscape`. The `{open && <Dialog/>}` mount contract stays (the "overlays enter; only
  menus leave" rule holds). Convert the 11 sites: `ConfirmDialog`, `ShortcutHelp`,
  `ForwardDialog`, `ImageLightbox`, `CatchUpPanel`, `FeedbackDialog`, `StartWorkDialog`,
  `CommandPalette`, `CreateChannelDialog`, `NewMessageDialog`, `ChannelDetails`. Then
  delete `lib/focusTrap.ts` and its test. Golden: the five existing dialog tests plus
  `Dialog.test.tsx` (Escape → onClose, backdrop click, focus stays inside).
- The 17 `let cancelled = false` copies onto `lib/useFetch.ts` (or `useAdminData` for the
  7 admin sections that bypass it); `BrowseChannels.tsx` drops its own debounce for
  `useFetch`'s `debounceMs`.
- `lib/format.ts`: `formatSize` ×3 → `describeSize`, date formatting ×6 → 1,
  `sortByDisplayName` ×5 → 1, "find #general" ×2 → 1.
- `components/EmptyState.tsx` for the 21 sites; migrate the five one-off classes
  (`agentic-empty`, `palette-empty`, `forward-empty`, `emoji-empty`, `dashboard-empty`)
  and delete their rules. Metric: `trapFocus` sites = 1 (Dialog), `let cancelled` = 0.

### W4 (Oct 5–11) · Backend mechanical dedupe — M

*Done 2026-09-12, with four corrections the code forced.* The plugin-row `Depends` would
have moved a read outside the request's transaction, so the 18 one-line prologues stay
where the transaction is. Folding `actor_for` into `record` saves no lines (every call is
already one argument per line) and was dropped. The four "uncalled" routes all have
tests holding them — `GET /api/channels/{id}` is how the privacy test proves a private
channel answers 404 to an outsider — so they stay; tests are callers of record. The
`bot_api` prologues move in W5 with `load_message_for` itself, since a router importing
another router's helper would break a property the codebase currently keeps. Shipped:
`OkOut` ×17 → `schemas/base.py`, the three shared envelopes, six error-phrase
factories, one membership arm in the activity feed, one mention-ability predicate,
`forget` and the two unused dependencies gone. It also caught a real ordering defect:
the agent socket sent `ready` before writing presence.


- `OkOut` → `schemas/base.py` (17 → 1); the pairwise twins (`MessageOut`,
  `MessagesOut`, `MembersOut`, `ChannelsOut`, `UsersOut`, `ReactionInput`,
  `EditMessageInput`, `ThreadSummaryOut`, `AgentTaskOut`, `AgentRunsOut`,
  `ArtifactOut`) → `schemas/models.py` / `schemas/requests.py`.
- `routers/plugins.py`: a `plugin = Depends(admin_plugin)` dependency replacing the 19
  `registry.by_id(session, plugin_id, admin.workspace_id)` + `not_found` prologues.
- `services/audit.py`: `record_for(session, request, user, action, …)` folding the 58
  `actor_for(request, user)` lines into their `record` calls.
- `lib/errors.py`: named factories for the repeated strings (`"That message is gone."`
  ×12, `"There is no such group here."` ×6, `"That channel no longer exists."` ×6, …).
- One `MEMBER_JOIN` SQL fragment beside `services/messages.IN_CHANNEL_HISTORY`, applied
  first to the three identical arms in `services/activity.py:211,231,249`; the
  "can this agent be mentioned" predicate `(agui_url IS NOT NULL OR runtime IN
  ('socket','builtin'))` into one constant used by `jobs/agui.py:92` and
  `routers/my_agents.py:142`.
- Route `routers/agentic.py:48 _root_message` and the six hand-rolled prologues in
  `routers/bot_api.py:{241,288,398,497,544,632}` through the existing
  `routers/messages.py:94 load_message_for`.
- Delete `services/agent_state.py:59 forget` (zero callers), `orjson` and
  `python-multipart` from `pyproject.toml` (never imported; uploads are presigned
  PUTs), `POST /api/channels/{id}/unarchive` (the admin twin is the one the client
  uses) and `PUT /api/admin/plugins/{id}`. For `GET /api/channels/{id}` and
  `GET /api/read-states`, apply the entrance trap first: grep `lib/help.ts` and the
  tests for a product behaviour that names them, and delete only the route, never
  `read_state.list_for_user` (M1's digest reuses it). Regenerate `openapi.json` in the
  same commit (`test_openapi_contract` enforces it). Metric: `class OkOut` = 1,
  backend −500 lines.

### W5 (Oct 12–18) · SQL out of routers — L

- `routers/admin.py` (1,037 lines in six commented sections: people, invitations,
  channels, audit log, settings and health, webhooks) → `services/admin.py`, section
  order kept, routers reduced to shape-and-authorize.
- `routers/auth.py:signup` (169 lines) → `services/signup.py`: workspace founding,
  invite acceptance, default channels, the one-email-one-password hash copy. This is
  also the seam M3's OIDC account-linking needs.
- `routers/users.py` (14 `text(`, including `UPDATE … RETURNING`) → `services/users.py`;
  `routers/plugins.py`'s 13 into `plugins/registry.py`; `routers/files.py`'s 8 into
  `services/files.py`.
- `services/meetups.py` (108 lines, 3 ORM calls) rewritten on `text()`; the grep
  exception CLAUDE.md has to explain goes away.
- Golden before moving: `test_admin.py`, `test_auth.py`, `test_one_password.py`,
  `test_password_reset.py`, `test_plugins.py`, `test_files_authz.py`, `test_meetups.py`.
- Add `tests/test_layering.py` as a ratchet (`text(` count in `routers/` may not exceed
  the last committed number); promote it to a torsor `forbid_pattern` when it reaches 0.
  Metric: routers `text(` 131 → ≤ 50.

### W6 (Oct 19–25) · Split along the named seams — L

- `jobs/agui.py` (1,127) → `agui.py` (`handle_agui_run`, `_claim`, the `_run`
  dispatcher), `agui_admission.py` (`listeners_for`, `personal_agent_for`,
  `agent_tools`, `_looks_busy`), `agui_outcome.py` (`_run_one`'s five-outcome
  classification, memory fold, artifact publish, `_post_as_bot`), and
  `plugins/run_stream.py` (`_CardBroadcaster`, `_wait_for_cancel`). Keep the names
  `test_agui.py` patches importable from where it patches them, or retarget the patches
  in the same commit (the patch-the-borrowed-name trap in `.torsor/active/context.md`).
- `services/mcp.py` (794) → `mcp_catalogue.py` (`_CATALOGUE` at :152–290, the JSON
  schemas, `catalogue`, `tools_for_agent`) and the handlers.
- `services/messages.py` (1,025): reactions, pins/saved/later, and thread subscriptions
  are three independent groups → `services/reactions.py`, `services/saved.py`,
  `services/thread_subscriptions.py`; `send` (217) loses its inline mention and
  attachment handling to named helpers.
- `routers/commands.py:run_command` (206 lines, 24 `hub.*` calls in one ladder) → a
  data-driven `announce_command(result, user, after)` beside `messages.announce`; the
  hub stays out of the service, the closure shape stays.
- `services/channels.announce_created(after, channel, views)` replacing the twin
  broadcasts at `routers/channels.py:113–126` and `routers/work.py:110–117`
  (`test_channel_events.py` pins the two-frame rule).
- Golden: `test_agui`, `test_agent_runs`, `test_agent_chains`, `test_agent_decisions`,
  `test_builtin_tools`, `test_mcp`, `test_commands`, `test_membership_commands`,
  `test_messages`. Metric: no function ≥ 200 lines.

### W7 (Oct 26–Nov 1) · Client structure and the store — L

- `Composer.tsx` (1,238) → `useMentionAutocomplete.ts`, `useEmojiAutocomplete.ts`,
  `useSlashCommands.ts`, `AttachmentTray.tsx`, `FormatToolbar.tsx`, `SchedulePicker.tsx`.
  Rule for the commit: the existing `Composer.*.test.tsx` files are unchanged and green,
  so the DOM does not move. Composer ≤ 500 lines.
- `ThreadPanel.tsx` (817 lines, 18 `useState`) → `ThreadSummary.tsx`, `ThreadTasks.tsx`
  (12 states → `useFetch` + one reducer), `useThread(rootId)`. Golden **first**:
  `ThreadPanel.test.tsx` (root + replies render, the `llm:` provider kicker, follow
  toggle), because it is untested today.
- `store.ts` hot spots, algorithmic rather than cosmetic:
  - `mergeById` becomes one linear merge of two id-sorted lists (O(n+m), not
    O(arrived × items) with two copies per item).
  - `upsert` binary-searches the insert position; `clientMsgId` matching only among the
    pending tail.
  - `withProjectedOutbox` overlays only the channels and threads whose entries changed
    (`setOutbox` diffs keys) and sorts the outbox once, grouped by channel, instead of
    once per channel and per thread.
  - `reaction.added/removed` and `thread.updated` stop remapping every open thread:
    the event carries `threadRootId: string | null` (`realtime/protocol.py`,
    `protocol.ts`, the two emitters at `routers/messages.py` and `routers/bot_api.py`;
    `test_protocol_parity.py` holds both sides).
  - Golden first: `store.identity.test.ts` asserting untouched channels keep the same
    `items` reference across an outbox mutation and a reaction. That property is also
    what stops the re-renders.
- Duplicated state: `ChannelView`'s local `memberIds` → a store selector;
  `ThreadPanel`'s `following`/`summary`/`tasks` → the hooks above; the two
  `setInterval` clocks → one `useClock`.
- Inline styles: `.grow`, `.min-0`, `.stack-*` utilities bound to the space tokens; a
  `<Field label hint>` component for the ~140 console field sites; a vitest
  source-ratchet test (`style={{` ≤ 60, `let cancelled` = 0). Metric: `style={{` count
  and the identity test.

### W8 (Nov 2–8) · Platform decisions, each with its gate — M

| Change | Verdict | What it deletes | Gate and rollback |
|---|---|---|---|
| **Generated TS types from `openapi.json`** (`openapi-typescript`, one devDep in `packages/shared`) | **Yes** | W10: the twins in `types.ts`, hand-typed return types in `api.ts` | `pnpm openapi` also writes `packages/shared/src/generated/api.d.ts`; `contract.test-d.ts` (vitest `--typecheck`) asserts each of the 50 hand-written types is assignable both ways. The dump's own rule: diff quiet for two weeks, then W10 switches `api.ts` to `paths[...]` and deletes the twins. `protocol.ts` stays hand-written (the socket union has its parity test). Rollback: revert W10 alone. |
| **React 19.3** | **Bump yes, refactor no** | Nothing today: 0 `forwardRef` sites, motion is CSS tokens, Fragment Refs delete a wrapper only where one exists for a ref alone | One commit: react, react-dom, `@types/react*`, `@testing-library/react` 16, `@vitejs/plugin-react` 5; fix the type fallout (`ref` as a prop, `React.JSX`), zero behaviour change. Gate: vitest file count unchanged. `useActionState` for the busy/saving pairs is an opportunistic Q2 cleanup, not a slice. |
| **Vite 8 (Rolldown)** | **Yes, conditional** | Build time | Separate commit after W2; needs vitest 4; `manualChunks` → `advancedChunks`. Gate: `time pnpm build` and main-chunk bytes both ≤ baseline, or revert. |
| **Native `popover` for `Menu`** | **Conditional on a one-hour spike** | `lib/usePresence.ts` (exit via `@starting-style` + `transition-behavior: allow-discrete`), the outside-click wiring, the `.message-list-row:has(.menu)` stacking rule at `app.css:6610` (top layer escapes the row's transform), the menu half of `useEscape` | Keeps a ~30-line `positionPanel` on `getBoundingClientRect`; `position-anchor` only under `CSS.supports('anchor-name: --x')` (85.9% is not enough). happy-dom 20.11.6 has no `showPopover`, so the spike decides whether a test-setup shim is honest. Pass → W9; fail → Q2 M2. |
| **TanStack Query** | **No** | It would delete `useFetch` + `useAdminData` (~110 lines) and the 17 copies | W3 deletes the copies with the 40-line hook already in the tree, adds no dependency, and does not put a second cache beside the zustand store the socket already keeps fresh. |
| **FastAPI 0.141 / Starlette 1.6 / Pydantic 2.13** | **Routine bump** | — | Starlette follows SemVer since 1.0. Hold SQLAlchemy at 2.0 while 2.1 is a release candidate. Skip Python 3.14 free-threading: nothing here is CPU-bound off the thread pool. |

### W9–W13 (Nov 9–Dec 13) · Ratchet and buffer

W10: the generated-types switch and the `types.ts` deletion. The popover migration if
the spike passed. The `routers/admin.py` remainder if W5 ran long. Three buffer days for
production incidents, because both instances deploy on every merge. Q1 closes with the
targets table re-measured and written into `docs/roadmap.md`.

---

## Q2 — Features (mid-Dec → mid-Mar)

### M1 (Dec 15 → Jan 15) · Agents you can trust

- **Free-text answer to an interrupted run — S.** `AgentRunCard.tsx` gets an input for
  `interrupted` runs whose decision has no enumerated options; the server side exists
  (`routers/agentic.py:460` → `services/agent_chains.answer`) and `api.agentRuns.answer`
  is already typed. Done when: a run that stopped to ask an open question can be
  answered from the card and resumes.
- **Bound what a shared agent reads — S–M, ADR 0017.** Precisely: Blob does not have
  Claude Tag's rule. ADR 0013 is *command* authority. `jobs/agui.py:agent_tools` gives
  @Blob the asker's eyes wherever it is asked, so @Blob mentioned in `#general` can read
  a private channel the asker is in and the room is not, and its answer lands in the
  room. New `workspace_policies.agent_reads`: `audience` (default: in a DM with the
  agent, everything the asker can see, which is the promise the agent DM header makes
  today; in a channel, only public channels and that channel) or `asker` (today's
  behaviour everywhere). Enforced in `services/mcp._resolve_channel` and the read
  handlers by a room-scoped predicate, refusing as "no such channel", never 403. A
  person's own MCP token is unchanged (ADR 0016: it *is* the person and answers only
  them). Tests in `test_builtin_tools.py`. Migration 0037 (shared with the two items
  below). Done when: the policy shows in the console and @Blob asked in `#general`
  cannot summarise a private channel the room cannot see.
- **Per-run usage on the budget meter — M.** AG-UI 0.1.22 terminal events carry usage
  per provider/model: `plugins/agui.py:Fold` captures it on `RUN_FINISHED`;
  `agent_runs.usage JSONB`; `services/agent_runs.finish(usage=)` and the console sum
  tokens; `lib/llm.py` returns a small `Usage` from Anthropic's `message_delta.usage`
  and OpenAI-shape `usage` chunks (DeepSeek included) as a return value, still three
  callers. `PluginCard.tsx`'s meter reads "12 runs · 41 min · 380k tokens". Done when:
  the Apps console shows yesterday's tokens per agent on both instances.
- **Approval cards for write tools — M.** OpenAI Workspace Agents default write
  actions to "always ask"; NanoClaw evaluates policy before execution. New
  `workspace_policies.agent_write_approval` (`always_ask` default when the write grant
  is on): an agent's `post_message` stores the pending write in `agent_runs.interrupt`
  (`kind: tool_approval`), the run ends `interrupted`, `plugins/decisions.decision_blocks`
  mints Approve/Deny; `routers/interactions.py:87`'s `decisions.run_id_of` branch executes
  the write through `send` + `announce` as the bot and `settled_blocks` records "approved
  by X"; `expire_agent_decisions` handles the 24-hour expiry. No model resume needed.
  The `approvals` console row becomes real (pending list). Done when: Approve posts,
  Deny settles, silence expires.
- **MCP GA alignment of `routers/mcp.py` — S.** Already stateless with header checks.
  Changes: `tools/list` returns the GA cache hints (`ttlMs` short, `cacheScope` per
  principal, since the catalogue is scope-filtered per token); MRTR `input_required` +
  an opaque signed `requestState` for `post_message` when the policy is `always_ask`
  (the assistant-side twin of the card); a per-era counter so the legacy `initialize`
  branch can be deleted after 30 days at zero. Not changing: bearer auth (CIMD matters
  only once OAuth 2.1 arrives with OIDC), the Tasks extension (no long tools), MCP Apps
  (`ui://` is ADR 0007 territory).
- **Email digest — M.** `prefs.emailDigest: off | daily | weekly` (prefs JSONB) and
  `users.last_digest_at` (migration 0037); `jobs/digest.py` runs hourly, picks people
  whose local 08:00 fell in the last hour (`services/notify._local_parts`), gathers
  unread channels (`read_state.list_for_user`) and mentions (`activity.feed`), sends
  nothing on a quiet day, `lib/mail.send_digest` plain-text like invites; a dead mail
  server logs and skips. Surfaced in `NotificationsSection.tsx`. Tests through the
  `mail` seam. Done when: one mail per day at 08:00 local with links, none when quiet.

### M2 (Jan 16 → Feb 15) · Slack habits and data portability

- **Server-side drafts — M.** `drafts` table keyed on (user, channel, thread root);
  `PUT/DELETE /api/drafts/{key}`; bootstrap carries them; `lib/drafts.ts` (176 lines)
  becomes cache-plus-sync with a `pagehide` flush via `sendBeacon`; a Drafts view in the
  sidebar. Done when: a draft typed on a laptop is in the phone's composer.
- **Custom sidebar sections — M.** `prefs.sidebarSections[{id, name, channelIds}]` (no
  migration); `Sidebar.tsx` renders them above the rest; `ChannelMenu` gains "Move to
  section…". Done when: "Clients" survives a reload on another device.
- **Forwarding with a record + image-group grid — S–M.** `messages.forwarded_from_id`
  (migration 0038); `send(forwarded_from=)`; `MessageRow` shows "Forwarded · Ana · 3 Sep"
  linking `/m/<id>`, naming the channel only if public; the quoted body stays for readers
  who cannot see the source. The stack-to-grid rendering rides in the same renderer pass.
- **Export — M.** `export_workspace` arq job → JSON-lines per table plus an attachments
  manifest → a zip in object storage → `lib/storage.presign_download`; the
  `import-export` console row becomes real; an audit event; a per-person export from
  `/settings` scoped by the same membership join search uses. Done when: an admin's zip
  reads with `jq` and a member downloads theirs.
- **Blob as an MCP client — spike behind ADR 0018, M.** `plugins/mcp_client.py`:
  stateless GA JSON-RPC with mirrored headers, `lib/net.assert_outbound_url` on
  registration and every call, first target Blob's own `/api/mcp` over loopback (a
  server the suite already trusts). `mcp_servers` admin table (url, bearer, allowed
  tools); granted tools merged into `agent_tools` after `tools_for_agent`; writes go
  through M1's approval card. Gate: one round trip ≤ 2 s inside `AGUI_MAX_RUN_SEC`, and
  the ADR decides scope (admin-installed only, read-only default, per-run budget)
  before any code beyond the spike. Done when: @Blob answers using an external read
  tool and the run card lists the call.
- **Agents view — M** (Slack's Aug 31 Agents tab). `/agents`: every agent with kind
  (workspace/personal), a status derived from `agent_runs` (idle / working in #x /
  waiting for you since …), the last card, Resume, Open DM. Reuses
  `services/agent_runs.views_for_member`, `AgentRunCard`, and the sidebar's Agents
  section. No presence events for apps (privacy principle): status is derived from
  runs. Done when: the Agents heading opens a page with live statuses.

### M3 (Feb 16 → Mar 15) · Contract, imports, identity

- **Playwright contract test — M.** `apps/web/e2e/contract.spec.ts` in CI's `image`
  job against the booted production stack: signup → channel → send → a second context
  sees it live → thread reply → reaction → search → upload. Done when: a contract break
  fails CI before anything deploys.
- **Slack import spike — M, conditional on M2's export format.** Parse an export zip;
  mint ids with `uuid_utils.uuid7(timestamp=…)` from Slack's `ts` so ordering holds;
  users become placeholders; private channels stay private. Done when: a sample export
  reads as channels with history in order.
- **OIDC — L, last.** Authorization Code + PKCE with discovery;
  `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET`; two exact `PUBLIC_ROUTES` entries, never a
  prefix; account linking by verified email through W5's `services/signup.py`; sessions
  unchanged; "Continue with SSO" on `AuthScreen`. Passkeys wait for demand. Done when:
  three env vars and a colleague signs in without a password.
- **Console rows.** `storage` → a small page over `sweep_orphans` results and bucket
  usage. `moderation` → delete the planned row: six months planned with no design is a
  promise, not a plan.

---

## Explicitly not doing, and why

- **E2EE chat.** Incompatible with search, summaries, catch-up and agents reading
  channels, which is the product. Chatto's maintainer made the same argument on the
  1,106-point HN thread. Revisit for DMs only, and only on demand. (Zulip's E2EE *push*
  is a different thing and is worth a look once push is in daily use.)
- **Matrix federation.** Mattermost v11.10 just made it a paid checkbox; no team under
  100 people has asked; bots-as-users does not federate.
- **Native mobile apps.** PWA + push is the accepted 2026 answer for this size of team.
  What ships instead is an honest note on iOS push limits in the notifications screen.
- **Single-binary / SQLite rewrite.** Chatto proved the demand, but Blob's SQL is
  Postgres by design: UUIDv7 keyset paging, `tsvector` + `pg_trgm` + `unaccent`, advisory
  locks on migrate. One image on one origin is already true.
- **Canvases, workflow builder.** A second product each. Work-channel artifacts cover
  "an agent hands me a document"; agents are the workflow story.
- **Semantic / pgvector search.** An embedding pipeline to operate; trigram search
  removed the pain it would solve. Reopen if a workspace asks for "ask" search after a
  quarter on a model.
- **Rewriting `/api/mcp` for MCP GA's stateless core.** Already true. MCP Apps (`ui://`)
  and the Tasks extension: not this window.
- **i18n, Serbian first.** String extraction touches every component and contradicts
  simplify-first. It is the first item after Q2.
- **SQLAlchemy 2.1, Python 3.14 free-threading, CSS anchor positioning as the only
  positioning, React Server Components, TanStack Query.** Reasons in W8.
- **Slackbot Big Mode, Skill Sets, DPoP agent identity.** Not on the roadmap of a
  self-hosted tool for teams under 100; DPoP is a roadmap item at MCP, not GA.

## Verification: the number behind every target

Run before W1 to fix the baseline, then after each slice; the targets are stated against
these exact commands.

```bash
# Lines, by area
find apps/api/src -name '*.py' | xargs cat | wc -l
find apps/web/src -name '*.ts' -o -name '*.tsx' | grep -v '\.test\.' | xargs cat | wc -l
wc -l apps/web/src/styles/app.css
grep -c "text(" apps/api/src/blob_api/routers/*.py | awk -F: '{s+=$2} END {print s}'

# Backend suite wall time and the 25 slowest tests
cd apps/api && time uv run pytest -q -n 4 --durations=25

# Client bundle: raw bytes per chunk, and what is inside the main chunk
cd apps/web && pnpm build && ls -la dist/assets | sort -k5 -rn | head
grep -o 'livekit' dist/assets/index-*.js | wc -l        # must be 0 after W2

# Duplication counters (ratchets; W7 turns the client ones into a vitest test)
grep -rc 'style={{' apps/web/src --include='*.tsx' | grep -v ':0$' | awk -F: '{s+=$2} END {print s}'
grep -rln 'let cancelled = false' apps/web/src | wc -l
grep -rln 'trapFocus(' apps/web/src | wc -l
grep -rn 'class OkOut' apps/api/src | wc -l
grep -rn 'actor_for(' apps/api/src | wc -l
ls docs | wc -l

# Contract
pnpm openapi && git diff --exit-code packages/shared/openapi.json
pnpm exec vitest run --typecheck packages/shared/src/contract.test-d.ts   # after W8

# The gate, exactly as CI runs it
pnpm check && (cd apps/api && uv run alembic check) && torsor guard --strict --severity error $(git ls-files '*.py')
```

One metric per slice: W1 suite minutes · W2 main-chunk bytes · W3 `trapFocus` and
`let cancelled` counts · W4 backend line delta · W5 routers `text(` count · W6 longest
function · W7 `style={{` count and the identity test · W8 hand-written type count. Q2
items are verified by their "done when", observed in a browser on the staging instance;
`alembic check` stays quiet after 0037 and 0038; the Playwright spec is green in the
`image` job.

Product-level checks no counter captures, run in a real browser after each client
slice: sign in, open a channel, send, see it arrive in a second tab, open a thread, ⌘K,
open every dialog and press Escape, resize to 500px.

## Four decisions to confirm at approval

1. **Delete the 13 stale planning docs and the two root plans** in W1 (history keeps
   them; CLAUDE.md already declares only the three guides current).
2. **`agent_reads` defaults to `audience`** (M1): @Blob in a shared channel reads only
   what the room could see; in its DM it keeps the asker's full reach.
3. **`agent_write_approval` defaults to `always_ask`** (M1) once the write grant is on.
4. **The `moderation` console row is deleted** rather than built (M3).
