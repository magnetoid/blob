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
