# The agentic surface, reviewed — and what to do next

**Date:** 2026-10-05, at 1.7.0 (`93665513`).
**Scope:** everything an agent touches — `plugins/` (4,900 lines), the agent services
(~7,000), their routers (~3,500), `jobs/agui*.py`, the client's `features/agentic`,
`features/work`, run cards, the store's run slice, the console pages, ADRs 0010–0020,
the three integrator guides, the README, and the 33 test files that cover the area
(~700 tests). Four read-only review passes covered transport, product services, client
and tests/docs/schema; every finding marked **verified** below was then re-read at the
cited lines by hand, and two were reproduced by running the fold.
**Outside:** AG-UI 1.0 (released 2026-09-30), the MCP `2026-07-28` revision and A2A 1.0
were checked so the plan builds the current thing, not the one the ADRs were written
against.

Sizes use the roadmap's scale: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

---

## 1. What is sound, and should not be re-planned

- **The decisions are right and they are written down.** Blob is the AG-UI client
  (0011); a bot is a real user (0005); a person roots every chain and authority flows
  down it (0013); a work channel is a private channel with a row (0014); an artifact is
  data and a page runs only in a sandbox (0007/0014/0020); an assistant token is the
  person (0016); an agent is the workspace's or one person's (0018); Blob ships no agent
  of its own (0019). Nothing below reverses any of these.
- **Three transports, one fold.** HTTP, dial-in socket and hosted container all feed
  `plugins/agui.Fold`; the socket runtime (0012) is the feature nobody else ships for a
  self-hosted product. Keep it.
- **The hard parts of multi-process are handled**: `SET NX` claims, subscribe-before-
  publish, Redis TTL presence, Stop as key + pub/sub, the transactional outbox with a
  circuit breaker for webhooks.
- **Privacy holds everywhere it was promised**: 404 for a private room, silence for an
  agent the asker may not command, nudges to the asker alone, no presence to apps.
- **Janus console key hygiene** (no key in any body, log or row) is careful and tested.
- **The test base is real**: parser edge cases, who-may-start-a-run, chain caps,
  socket claims, MCP negatives with a second account, delivery retries against a live
  socket.

---

## 2. Verified defects in the run path

| # | Where | What happens | Fix | Size |
|---|---|---|---|---|
| D1 | `jobs/worker.py:243` vs `config.py:175` | arq's `job_timeout = 300` kills every run at five minutes while `AGUI_MAX_RUN_SEC` promises ten. `asyncio.wait` is cancelled, the stream task is orphaned, `_finish` never runs, the row stays `running` until the 04:10 sweep and keeps charging the agent's seconds budget. The socket claim (`plugins/gateway.py:61`, `CLAIM_TTL_SEC = 300`) is never refreshed, so after minute five `owns_run` fails and every event is dropped silently. | `func(agui_run, timeout=AGUI_MAX_RUN_SEC + 60)`; refresh the claim on each event or set its TTL to the ceiling; a test that pins both against the setting. | S |
| D2 | `jobs/agui.py:272-290`, `jobs/agui_outcome.py:611-689` | `run_one` has no exception boundary and `gather(return_exceptions=True)` discards what escapes. A storage outage, a bot removed mid-run, or Redis failing in `is_online` leaves a `running` row and a card that never ends. The comment above `gather` says the opposite. | `try/except` around the body of `run_one` that writes `failed` with the error and logs it; test with a storage failure. | S |
| D3 | `plugins/streams.py:230-237` | On the socket, an idle or wall-clock exit with partial text returns success; on HTTP the same case is "did not finish in time". A dropped socket costs 150 s of silence, then half an answer marked succeeded. `publish` never checks that anyone was subscribed (`gateway.py:111`). | Same outcome on both transports: partial text posts with a "cut short" line, status `failed`; zero subscribers at publish time → immediate "not connected" card. | S |
| D4 | `services/agent_chains.py:181,255` with `jobs/agui.py:214` | A resume keeps the asking run's depth. At depth ≥ 1 `admit` runs and drops the asking agent as "mentioned itself", so a decision raised inside a hop can never be answered. Tests cover depth 0 only. | Resumes bypass the self-mention rule (a resume already targets exactly one agent); test at depth 1. | S |
| D5 | `plugins/agui.py:224-230,439` | A `TEXT_MESSAGE_START` with a non-assistant role is ignored, but the following `CONTENT` reopens the buffer through `setdefault`. Quoted user or system text is posted as the bot's answer. *(Reproduced.)* | Remember ignored message ids and drop their deltas. | S |
| D6 | `plugins/streams.py:41` | The fold starts with `state=None`, not the state sent in the request, so a run that emits only `STATE_DELTA` loses its memory. *(Reproduced.)* | Seed `Fold` with the input state. | S |
| D7 | `plugins/agui.py:128-136`, `jobs/agui.py:48-60` | Post idempotency keys on the agent's own `messageId`; most frameworks mint a fresh UUID per run, so a redelivered or retried job double-posts. The message-level lease is 300 s and fails open. | Make the run row the ledger: a job that finds a terminal run for its trigger stops; key posts on `(run_id, ordinal)`. | S–M |
| D8 | `services/messages.py:417-425` | Thread history is the **oldest** 1,000 messages, so in a long thread the mention that triggered the run is not in what the agent reads. | Root plus the newest N; keep the trigger. | S |

## 3. Authorization and policy holes

**Verified**

- **A1 — Decision buttons can be spoofed.** `agent_answer:` is not reserved
  (`plugins/blocks.py:33` accepts `:`; `plugins/decisions.py:27`), and `agent_chains.answer`
  never checks that the pressed message is the run's `decision_message_id`
  (`routers/interactions.py:66-80`). Any app may post a lookalike button in a room the
  asker can see; the run id reaches apps through `message.created`. If the asker presses
  it, a real pending decision is answered with an option the attacker chose. Fix: refuse
  the prefix from apps, and assert `message_id == decision_message_id` in `answer`. **S**
- **A2 — Repo installs skip `denied_scopes`.** `routers/plugin_hosting.py:132` calls
  `_assert_within_policy(…, [])`; the only real check is on the manual path
  (`routers/plugins.py:426`). **S**
- **A3 — Offboarding leaves a person's agents running.** `services/admin.deactivate`
  touches sessions and handles only; the person's agents stay enabled, their bot tokens
  valid, their delegations live. **S**
- **A4 — The kill switch is partial.** `agentsEnabled` stops mention-triggered runs
  only; bot-API writes, app commands, deliveries and socket connections continue. Decide
  what "off" means and make the switch mean it. **S–M**
- **A5 — Reasoning is shown to the room, and the docs say it is not.** The card keeps a
  2,000-character reasoning tail (`plugins/run_card.py:63-69`) and shows it behind a
  toggle to everyone in the channel; `docs/apps.md:357` tells authors reasoning is
  ignored. Either is defensible; both at once is a broken contract, and reasoning is
  where a prompt-injected agent narrates what it read. Default to hidden; a per-agent
  flag for agents whose authors want it shown. **S**
- **A6 — Memory is keyed per (agent, conversation), not per person.** A lent-out agent
  hands the owner's state to the grantee's run. Key on the asker when the agent is
  owned. **S**

**Reported by the review, not re-read by hand**

- Declining scopes removes grants but keeps the event subscriptions
  (`plugins/registry.py:455-485`; `plugins/events.py:103` never re-checks).
- Ownership transfer keeps the previous owner's delegations (`registry.py:734-756`).
- Task rules differ by path: members cannot assign to agents, bots can reassign anyone;
  task creation and summary refresh skip the archived check (`routers/agentic.py:47-52`).
- The agent picker and `work.start` ignore delegations and skip the may-command check
  (`services/my_agents.py:45`, `services/work.py:421`) — the ownership rule is copied in
  four places and has already drifted.
- A member naming a personal agent "Janus" takes the slug and the seeder skips the
  workspace (`services/janus_agent.py:166-184`).
- No `Origin` check on any WebSocket; `SameSite=Lax` blocks cross-site but not a sibling
  subdomain, which is where hosted agents live.

---

## 4. Protocol currency

**AG-UI.** 1.0 froze the spec on 2026-09-30 and is backwards compatible, so nothing
breaks — but Blob's reader was written against 0.x and the gaps are now product gaps:

- No `protocolVersion` is sent (`plugins/agui.py:736-740`); `tools` is always `[]`.
- Eleven event types are folded. `ACTIVITY_*` is read as top-level string keys
  (`run_card.py:155`) where 1.0 carries a `content` object and JSON-Patch deltas, so a
  conforming agent's progress renders nothing. `SUBAGENT_STARTED/FINISHED/ERROR` are
  ignored. Usage on `RUN_FINISHED` is not captured. Multimodal input parts exist and
  Blob drops every attachment-only message (`agui.py:668`). Several `Interrupt`s are
  all answered with one payload (`agent_chains.py:172-174`).
- ADR 0011 says the official SDK is a test dependency used as a conformance oracle. It
  is in neither `pyproject.toml` nor the lockfile and `tests/test_agui.py` does not
  import it. There is no machine check that the reader matches any version of the spec.

**MCP.** The dual-era `/api/mcp` is already stateless and matches the GA shape. Missing:
`ttlMs`/`cacheScope` on `tools/list`, MRTR `input_required` for a write that needs
approval, and OAuth 2.1 — which is what keeps claude.ai connectors out while Claude Code
works. Seven tools; no DMs, no unread or mentions inbox, no thread list, no search
paging (the cursor is dropped at `services/mcp.py:360`), no idempotency key on
`post_message`, no expiry, no admin view, nothing about agents.

**A2A.** Checked and not needed. Chains already give agent-to-agent inside one
workspace on a person's authority, and AG-UI 1.0's subagent family covers delegation
inside a run. Revisit only if an external A2A agent must be federated in.

---

## 5. Capability gaps against the north star

The stated goal is agents as teammates. Today an agent can only **answer a mention or
a DM, read the last 30 messages, and write one conversation**. Everything below is what
stands between that and a teammate, in the order it should be built.

1. **Tools.** `tools: []` is the decision ADR 0019 deferred. An agent cannot search,
   read another channel, open a thread, create a task, or read the file somebody shared.
   The catalogue already exists — `services/mcp_catalogue.py` is seven tools with
   authorization — and the resume machinery already exists (`parentRunId`, `state`).
   Frontend tools over AG-UI are the standard loop: the agent emits `TOOL_CALL_*` and
   finishes, Blob executes on the rooting person's authority with the room as ceiling
   (ADR 0017's predicate, which 0019 kept "for the day an external agent is offered
   Blob's tools"), appends the `tool` result and resumes. Every call lands on the card;
   writes go through the approval card the roadmap already names.
2. **Streaming you can see.** ADR 0011 is right that a message is written once. It does
   not follow that a person sees nothing for ten minutes: the card already receives a
   snapshot four times a second over `agent_run.updated`, so carry a bounded text tail
   in it and draw it as a draft. No edit path, no `edited_at`, no change to 0011.
3. **Proactive runs.** No schedule, no trigger, no task dispatch; `scheduled_messages`
   carrying an `@` is the only way to run an agent unprompted, and assigning a task to
   an agent fires nothing. A person-created schedule and a person-assigned task both
   satisfy 0013's "a person roots every chain".
4. **Multimodal input.** Images, files and voice transcripts never reach the agent.
5. **Memory with a shape.** 64 KB per (agent, conversation); no per-person key, no way
   to see or reset it, no retention, no FK.
6. **Usage and cost.** Budgets count runs and seconds; AG-UI 1.0 reports tokens.
7. **Approvals.** Planned row, "not yet available" guardrail. Needed before tools.
8. **Observability.** Nothing: no metrics, no traces, no per-run event log; `last_error`
   is one overwritten string.

---

## 6. The client

- **Run state goes stale on reconnect** (`store.ts:1899-2001` refetches messages,
  channels and calls, not runs or work). A run that ended during the gap keeps its bar
  and Stop; Stop answers 404; Home counts it live. Channel open and Home `mine()`
  overwrite newer event state unconditionally (`store.ts:860-870`, `HomeView.tsx:43-55`).
- **Home shows other people's decisions as yours** — the run view carries no asker
  (`services/agent_runs.py:529-549`), so "Needs you" is everyone's.
- **Five components subscribe to the whole `agentRuns` map** and `AgentRunCard` is not
  memoised, so one agent's snapshots re-render the sidebar and the open conversation
  four times a second.
- Fields sent and never drawn: `textChars`, `dropped`, `expiresAt`, `chainId`,
  `parentRunId`. `api.agentRuns.answer` is never called; decision clicks send no
  `clientActionId` though the server de-duplicates on it.
- No run history for members; the admin log is 30 rows with no drill-in. No delegation
  UI (`/allow` only). The repo-hosting entry point was removed in `7540d2e0` and its API
  client remains. The terminal reports a refusal after every normal close.

---

## 7. Code health in this area

- **Oversized:** `routers/plugins.py` 1,059, `plugins/registry.py` 882,
  `services/janus_console.py` 848, `services/agentic.py` 808, `store.ts` 2,382 with runs
  inline; `_run` ≈ 185 lines, `_finish` ≈ 125.
- **Duplicated and drifting:** the ownership predicate ×4 (already drifted, §3); the
  listener SQL ×2 (`jobs/agui_admission.py:43-67,115-159`); the run view ×3; request
  signing ×3; `work.updated` payload ×3; artifact limits ×2; two folds parse the same
  stream with different coverage; `post_as_bot` duplicates the bot API and agent replies
  never get unfurls.
- **Vestigial:** the `local` runtime (refused at install, no loader), `builtin` in the
  `agent_runs` transport check, write-only columns (`plugin_secrets.rotated_at`,
  `plugin_grants.granted_by/at`, `agent_delegations.granted_by`, `bot_tokens.last_used_at`,
  `scheduled_messages.sent_message_id`), `agent_state` with no retention and no FK.
- **Reported, worth measuring:** no index on `agent_runs.parent_run_id`, `channel_id`
  or `decision_message_id`, nor `work_artifacts.run_id`; `views_for_channel` ORs past
  its index on every conversation load; per-row Redis online checks in the console.
- **Docs drift:** `apps.md` still promises a `RUN_ERROR` chat message (removed
  2026-09-18), says reasoning is ignored, says 120 s where the limits are 30 s idle /
  600 s wall (300 s in practice, D1), lists four injected env vars (there are five), and
  never mentions `aguiPath`, `port`, `build: dockercompose`, the `cancel` frame, the
  delivery breaker, `threads.summarize`/`tasks.*` on the bot API, or `AGUI_HISTORY_LIMIT`
  /`AGUI_MAX_EVENTS`/`AGUI_MAX_BYTES`. `README.md:225-228` describes the read bound that
  migration 0042 dropped and cites the superseded ADR 0017.

---

## 8. The plan

Ordered by what unblocks what. Phase 0 is a precondition for everything after it:
building tools on a run path that loses runs at five minutes and swallows exceptions
would hide every new failure behind the old ones.

### Phase 0 · Make what exists true — 1–2 weeks, all S

- D1–D8 from §2, each with the test the review found missing: run past 300 s, storage
  failure mid-run, socket dropped mid-run, a decision at depth 1, a quoted user message,
  delta-only state, a redelivered job, a 1,200-message thread.
- A1–A6 from §3, each with its negative test: a lookalike button → 400; a repo manifest
  asking a denied scope → refused; deactivate → agents disabled, tokens revoked,
  delegations ended; the switch off → every path refuses; reasoning hidden by default.
- One ownership predicate in `services/agent_access.py`, used by `/allow`, the picker,
  `work.start` and admission. Delete the other three.
- Docs made true (§7), and the README's agent section brought to 0019.
- A conformance oracle: `ag-ui-protocol` 1.0 as a test dependency and a fixture-driven
  test over every family, so the next spec change fails a test rather than an agent.
- Client: refetch runs and work on resync with the same ordering guard calls use;
  `initiatedByUserId` on the run view and Home filtered by it; Stop on a finished run
  settles the card instead of 404; `clientActionId` on decision clicks.

**Done when:** a Janus run of eight minutes finishes with its answer posted; the suite
has a test for every row in §2 and §3; `docs/apps.md` matches `plugins/agui.py`.

### Phase 1 · AG-UI 1.0 — M

- Send `protocolVersion: "1.0"`. Accept and pass content parts: an image, a document,
  a voice transcript travel as parts under a size cap, so the agent sees what the person
  shared.
- Fold `ACTIVITY_*` per spec; `SUBAGENT_*` on the card; several interrupts answered
  separately; `Interrupt.expiresAt` honoured and drawn.
- Capture usage from `RUN_FINISHED` into `agent_runs.usage` (the roadmap's M1 item);
  the budget meter reads tokens.
- Per-agent `shows_reasoning` flag, default off.

**Done when:** a 1.0 reference agent's progress and token usage show on the card, and
an attached PDF reaches Janus as a document part.

### Phase 2 · Tools for agents, with approval — L

The decision 0019 deferred, taken as its own ADR (0022).

- `RunAgentInput.tools` carries Blob's catalogue — `search_messages`, `read_channel`,
  `read_thread`, `list_people`, `create_task`, `fetch_attachment` (text), `post_message` —
  the **same** catalogue `/api/mcp` serves, from `services/mcp_catalogue.py`, so there is
  one definition of what a tool does and who it is scoped to.
- Execution on the rooting person's authority, the room as the ceiling (ADR 0017's
  predicate restored in `services/mcp.py`), each call a line on the card with its
  arguments redacted to a summary.
- Loop: `TOOL_CALL_END` → the run finishes → Blob executes → resume with a `tool`
  message, through the resume path that exists. Bounded: eight tool rounds per run, the
  chain clock still applies.
- `workspace_policies.agent_write_approval` (default `always_ask`, as approved on
  2026-09-12): a write tool stores a pending action in `agent_runs.interrupt`, the run
  ends `interrupted`, Blob mints Approve/Deny, the `approvals` console row becomes real.
  The MCP twin is MRTR `input_required` with a signed `requestState`.
- Injection-first: tool results are data, quoted into the transcript with a role, never
  interpolated into instructions; a result that contains an `@` never starts a hop.

**Done when:** in a channel, "what did #ops decide last week?" is answered from a search
the card shows; "post that to #general" asks first; the same question through Claude
Code gets the same answer and the same ask.

### Phase 3 · Proactive runs — M

- **Scheduled runs** as a first-class row (agent, channel, cron, prompt, creator); the
  creator roots the chain; the Scheduled view knows the difference from a message.
- **Task dispatch:** assigning a task to an agent starts a run with the task as context;
  the run's outcome updates the task; `task.updated` reaches socket agents and Janus,
  not only external apps.
- **Event triggers** (later, gated on a request): a manifest `triggers` list for
  `channel.created`, `file.shared` and the like, admitted like a scheduled run.

**Done when:** a Monday 09:00 run posts a standup prompt and the resulting task list
assigns itself; a task handed to Janus comes back answered without a mention.

### Phase 4 · Streaming in the card, and run transparency — M

- `textTail` (≤ 2 KB) on the card snapshot, drawn as a draft while running; the message
  is still written once.
- Run history per conversation and per agent for members; the admin log drills into a
  run; "what the agent saw" (count, window, instructions yes/no, tools called).
- Chain view from `chainId`/`parentRunId`; inline answer from the card and Home through
  the unused `agentRuns.answer`; `expiresAt` countdown; a push when a decision is yours.
- One `useRun(id)` selector; `AgentRunCard` memoised; the runs slice out of `store.ts`.

### Phase 5 · Memory and delegation you can see — M

- Memory keyed per person when the agent is owned; a page to inspect and reset it; a
  retention sweep and the FK `agent_state` lacks.
- Delegations listed and revocable in Settings; `/allow` stays.

### Phase 6 · MCP, second pass — M

- Tools: DMs, an inbox (unread + mentions), thread list, search paging, `clientMsgId`
  on `post_message`, reactions, and the agent tools (`ask_agent`, `run_status`,
  `answer_decision`, `stop_run`).
- Tokens expire; the workspace console lists them; `ttlMs`/`cacheScope` on lists.
- OAuth 2.1 with Client ID Metadata Documents **only when a claude.ai connector is
  actually wanted** — it is the one thing between Blob and "add to Claude".

### Phase 7 · Observability — M

- OpenTelemetry: a span per run and per tool call, `traceparent` forwarded to the agent
  and read from MCP `_meta` as the spec now describes; a `/metrics` endpoint with runs
  by status, latency, tokens.
- A capped per-run event log (last 200 raw events, 7 days) behind the admin drill-in;
  `last_error` becomes the last ten.

### Phase 8 · Ratchets, continuous

- Split `routers/plugins.py` and `plugins/registry.py` along the seams the review
  named; one listener query, one run-view builder, one signing helper, one fold.
- Drop the `local` runtime and the `builtin` transport check; delete or read the
  write-only columns; add the `agent_runs` indexes after measuring the nightly delete.
- `lib/sourceRatchets.test.ts` gains a counter for whole-map `agentRuns` subscribers.

---

## 9. Not doing, and why

- **Token streaming into messages.** ADR 0011's four reasons stand; the card tail (Phase
  4) gives the visible half at none of the cost.
- **A2A.** See §4.
- **An app marketplace.** The 2026 integration surface is a tool catalogue an agent
  reaches, and Phase 2 builds it; a directory of apps that post messages is the old
  shape.
- **OAuth before a connector asks.** Bearer works for Claude Code and every server-side
  client today.
- **A second worker queue** for runs. Fix the timeouts first (D1); split the queue only
  if a hung agent is measured starving notifications.

## 10. Four decisions to confirm before Phase 2

1. **Reasoning default:** hidden unless the agent's row says otherwise (recommended), or
   shown as today with the docs corrected.
2. **Tool authority:** rooting person's reach bounded by the room (restores 0017,
   recommended), or the person's full reach everywhere.
3. **Approval default:** `always_ask` for every write tool (approved 2026-09-12), or
   per-agent trust.
4. **Memory key:** per person for owned agents (recommended), or shared per conversation
   as now.

---

## Phase 0 — done (2026-10-07, branch `agentic-phase-0`)

Every row of §2 and §3's verified list is fixed with a test that fails without the fix
(the chain resume and the decision-spoofing tests were checked by reverting the fix).
Where the work departed from the plan:

- **A4 was not a hole.** Every way a run starts — root, hop, resume, a scheduled
  message, a DM — passes the same switch, and the console's own words say what it
  covers ("mentions of agents are refused and nothing is dispatched; apps still receive
  webhook deliveries"). A test now pins that a hop already on its way is refused.
- **A6 is half of the plan's answer.** Memory rows are keyed by a `uuid` column, so a
  per-person key needs the migration Phase 5 already plans. Until then a borrowed agent
  runs without its owner's memory and does not write to it; the owner's own runs are
  unchanged.
- **Four of §3's reported items were real and cheap, and are fixed:** delivery now asks
  for the event's scope at send time (declining scopes left subscriptions live); a change
  of owner ends the old owner's loans; personal agents can no longer take the `janus`
  slug; a cookie WebSocket from a foreign origin is treated as signed out (the agent
  terminal is a root shell).
- **Left for later:** task rules that differ between the person's and the bot's routes
  (§3), and everything in §7 beyond the ownership predicate.

**A Phase 1 constraint found on the way:** AG-UI's Python SDK forbade unknown input
fields until 0.1.10, so sending `protocolVersion` to
every agent would 422 the older ones. The 1.0 spec's own answer is that an agent states
its version in `RUN_STARTED.protocolVersion` and a client omits the field for a peer it
knows predates it — so Phase 1 learns each agent's version from its runs and sends 1.0
fields only to agents that have said they speak it.

## Phase 1 — done (2026-10-07, branch `agentic-phase-1`)

AG-UI 1.0 is spoken to an agent that says it speaks it, and to nobody else: an agent's
`RUN_STARTED.protocolVersion` is remembered (migration 0046), and only then is it sent
`protocolVersion` and the files in its conversation as content parts. A 400 or 422 to a
1.0 run forgets the version again. Usage is kept on the run and shown, never capped, and
reasoning is off the card unless an admin turns it on. As planned, with one addition: every
message names its files in its text for every agent, since attachment-only messages had
been dropped from the history altogether.

## Phase 2 — done (2026-10-07, branch `agentic-phase-2`, ADR 0022)

Agents may use Blob's MCP tools as AG-UI client-executed tools, per agent
(`plugins.tool_access`, migration 0047): as the asker, inside the room, and every
`post_message` stops for the asker's Approve. The decisions of §10 were taken as
recommended: reasoning hidden by default, the room as the bound (0017's rule, returned),
writes always ask, and a borrowed agent runs without its owner's memory until Phase 5.

## Phase 3 — done (2026-10-07, branch `agentic-phase-3`, ADR 0023)

- **Task dispatch, as planned.** Handing a task to an agent posts a hand-off from the
  person who assigned it, in the task's thread, mentioning the agent alone; the run is an
  ordinary mention on their authority and is told the task as a `context` item. How the
  run ends moves the task, and only while it is still in progress with that agent
  (`agent_tasks.dispatch_message_id`, migration 0048). A `task.updated` frame tells the
  room, so an open thread shows the task done when the agent answers.
- **"Only admins can assign work to an agent" is gone for agents.** It predated agents
  having owners; the rule is now the mention's own (`MAY_COMMAND`), which also stops an
  admin commanding somebody's own agent by assigning it work. An app's bot that is not an
  agent keeps the admins-only rule and gets no run.
- **Scheduled runs departed from the plan: no new row.** A scheduled message that
  mentions an agent already roots a chain on its author's authority, and the scheduler
  already repeats daily, on weekdays and weekly. The Scheduled list now marks such a
  message as a run. A second scheduler would have been a second place for every rule to
  be forgotten.
- **Event triggers were not built**, as the plan said: gated on a request.
- **Found on the way:** the person's task routes skipped the archived check (§3), and
  `GET /api/agents` labelled an agent lent to you as yours. Both are fixed.
- **"`task.updated` reaches socket agents and Janus":** it does through the run. An agent
  is told of its task by being run on it, whatever its transport; a later edit to the
  task does not re-run it.
- **The review of this phase found two real faults, both fixed on the branch:** two
  retries at once could both hand a task over (the save now decides under a row lock),
  and the task card froze every field once one was edited, so a priority change saved
  after the agent finished reopened the task and ran the agent again (the card now sends
  only what was touched, and a retry no longer starts from done or cancelled).

## Phase 4 — done (2026-10-07, branch `agentic-phase-4`)

- **The card carries a draft of the answer** — the last 2,000 characters while the run
  writes it, plain text, never kept on the row and gone the moment the answer is posted.
  ADR 0011 stands: the message is still written once.
- **A run keeps what it was shown** (`agent_runs.seen`, migration 0049): message count and
  window, files, whether instructions, memory and a task went with them, the tools it was
  offered, the protocol spoken. Counts and names, never content. It is on the card's
  details, in the new run history, and on the console's log, whose rows now open onto the
  run's work.
- **Run history for members:** `GET /api/agent-runs/history`, keyset on the run id, by
  conversation or by agent (named by its app or by the member it is), only in rooms the
  person can see; reached from the conversation's menu, and in an agent's DM it is that
  agent's everywhere.
- **Chains, answers and deadlines on the card:** the chain a run sits on as one line, the
  question with its choices answerable by its asker on the card and on Home (answered by
  the choice's place; the agent receives the declared value; words are refused for a
  question that offered choices), and the time left to answer.
- **"A push when a decision is yours" is a mention, not a new channel.** The decision
  message names its asker and mentions them, so it reaches them through the ordinary
  notification path — badge, push, Activity — with no second mechanism to keep in step.
- **"The runs slice out of `store.ts`" is a module, not a zustand slice.** The run frames
  fold in `lib/agentRuns.ts:applyRunEvent`; the selectors live in `lib/useRuns.ts`; lists
  hold ids and cards subscribe to their own run. Five views redrew on every card snapshot
  before; now one card does.

## Phase 5 — done (2026-10-08, branch `agentic-phase-5`, ADR 0024)

- **Memory is somebody's.** The workspace's agent keeps the conversation's memory; an
  agent somebody owns keeps one per person — its owner's and each borrower's own — so a
  loan lends the agent and not what it knows. This replaces phase 0's stopgap, where a
  borrowed run went without memory.
- **Seen, cleared and ended.** Settings lists what agents remember of your own
  conversations and clears it; an agent's console page lists its conversation memories in
  rooms the admin can see and clears one or all. A 90-day sweep forgets what nobody
  writes, and a deleted channel takes its memories with it — the foreign key `agent_state`
  lacked is `channel_id`, backfilled from the key (migration 0050).
- **Loans you can see.** Settings lists who your agent is lent to, everywhere or in which
  channel, and ends a loan; `/allow` and `/disallow` stay as they were.

## Phase 6 — done (2026-10-08, branch `agentic-phase-6`)

- **Tools, as planned:** `inbox`, `list_threads`, search paging by cursor, `client_msg_id`
  on `post_message` (scoped to the token), `message_person` for DMs, `add_reaction`, and
  the agent tools — `ask_agent` (a mention composed for the person, with the mention's rules
  asked up front so an assistant is told why nothing happened), `run_status` (status, the
  question and its numbered choices, and what the agent answered), `answer_decision`,
  `stop_run`. Stopping a run moved into `services/agent_run_control.py`, which the card's
  Stop now shares.
- **Every token ends** (30, 90 or 365 days; migration 0051) and **Admin → Assistants**
  lists every connection with whose it is, and revokes any.
- **The 2026-07-28 shape:** every modern result says `resultType: "complete"`, carries
  `io.modelcontextprotocol/serverInfo` in `_meta`, and `tools/list` and `server/discover`
  carry `ttlMs`/`cacheScope` — read off the current specification, where all three are
  requirements, not options.
- **Not built:** OAuth 2.1, as planned — only when a claude.ai connector is wanted. MRTR
  `input_required` was not needed: an assistant's post is its person's own act, with the
  posting tick as the consent, so there is no approval to ask for mid-call.
- **Its review** found no defect at its bar. It named one inconsistency, closed on the
  branch: `answer_decision` now keeps a room's ceiling as `run_status` and `stop_run` do.
  No caller bound to a room may write today, so it guards a future path, not an open one.

## Phase 7 — done (2026-10-08, branch `agentic-phase-7`, ADR 0025)

- **Traces, off until named.** With `OTEL_EXPORTER_OTLP_ENDPOINT` set, a run is an
  `invoke_agent` span, Blob's tools run for an agent are `execute_tool` children, and an
  MCP request is a SERVER span continuing the assistant's trace from `params._meta`. The
  agent is sent `traceparent` as a header, and on the socket's run frame, which the bridge
  forwards. Spans carry ids, names, counts and outcomes, never content. With no endpoint
  nothing is injected or read.
- **`/metrics`, behind `METRICS_TOKEN`** and a 404 without it: runs by agent and outcome,
  duration, tokens, Blob's tools by caller and outcome — counters every process shares
  through one Redis hash — and runs in flight and decisions waiting, read live.
- **A run keeps what it streamed** for a week — its newest 200 events, cut down, reasoning
  stripped unless the agent shows it — and an admin reads them under the run only where
  they can see the room. **An app keeps its last ten errors** with their times (migration
  0052).
- **Not built:** OpenTelemetry metrics over OTLP, HTTP spans for every route, and carrying
  the trace of the message that started a run into the worker.
- **Its review** found no defect at its bar.

## Phase 8 — done (2026-10-08, branch `agentic-phase-8`)

- **One of each.** The listener query is one select, one answering filter and one builder;
  every signed request takes `signing.signed_headers`; a run is announced with the
  service's own view; `work.updated` has one builder.
- **The console's code split where its pages do.** `routers/plugins.py` (1,266 lines) is
  three routers on its prefix — 716, 283 and 328 lines — and `plugins/registry.py` (972)
  gave its agent setters to `plugins/agent_settings.py` and the delivery log to
  `plugins/delivery.py`, leaving 789.
- **What was never built is gone.** The `local` runtime leaves the manifest, the install
  route and `plugins_runtime_check`, and `builtin` leaves `agent_runs_transport_check`
  (empty since 0041); ADR 0009 is marked superseded.
- **Indexes, measured first.** The nightly sweep of 8,000 of 40,000 runs went from 56 s to
  0.3 s with `agent_runs_parent` and `work_artifacts_run` (migration 0053). The keys into
  `messages` were left: the app never hard-deletes a message.
- **Columns written and never read:** a secret's rotation and a bot token's last use are
  on the app's card; the grant and schedule records are kept, with the reason in the
  models. The client ratchet counts whole-map run selectors (0) and map scans (4).
- **Not done:** one fold for the two stream readers, and `post_as_bot` adopted by the bot
  API — each changes a contract (the fold's coverage, `/api/v1/`) and wants its own
  reviewed change.
- **Its review** found no defect at its bar.

## Where it stands

Every phase is built, tested and reviewed on its own local branch, each stacked on the one
before: `agentic-phase-8` holds all of them. Nothing is pushed or merged, because a merge
to `main` ships to production. Merging brings migrations 0046 to 0053, which run on
deploy; three new runtime dependencies (OpenTelemetry's API, SDK and OTLP/HTTP exporter);
and three settings, all off until set (`OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `METRICS_TOKEN`). The version bump and `pnpm stamp` belong
to the merge commit.
