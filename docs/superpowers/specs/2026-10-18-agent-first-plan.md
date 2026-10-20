# Blob → a cutting-edge, agent-first team platform: assessment and plan

Date: 2026-10-18 · against `main` at 1.10.0 (`d90c8bf3`) · approved the same day.
This replaces Q2 of [`docs/roadmap.md`](../../roadmap.md); its items are absorbed below, none dropped.

## Context

Blob is asked to be two things at once: a **professional communication tool** a Slack team
can move to without relearning anything, and an **agent-first organisation platform** where
agents are real teammates. Eight weeks of work (1.8.0 agentic phases 0–8, 1.9.0 Meadow,
1.10.0 security phase 1) built a sound base. This plan answers "what is still between Blob
and the state of the art in October 2026", ordered by what unblocks what.

### What is sound (do not re-plan)

- **The run path is true to its ADRs**: AG-UI 1.0 negotiated per agent, chains (0013),
  rooms as the ceiling (0017/0022), tasks handed to agents (0023), per-person memory
  (0024), run events + `/metrics` + OTel spans (0025). 1,821 backend and 1,247 client
  tests; contract tests for OpenAPI, protocol parity and generated types.
- **Slack parity is essentially the floor already**: threads, follow, summaries with
  citations, saved/Later, pins, reactions, ⌘K with scopes (the README still says this is
  unbuilt — it shipped 2026-09-18), tsvector+trigram search with filters, presigned
  uploads with previews, push, quiet hours, meetups on LiveKit, 18 slash commands, a
  Slack-shaped bot API, blocks.
- **Security phase 1** shipped; MinIO root rotated.

### Where it falls short of the 2026 bar (measured, not guessed)

The market moved to **agents that work while you are away**. Claude Tag (Jun 2026): a
shared agent *follows* channels, keeps channel-scoped memory, has an *ambient* mode that
flags things and chases unresolved threads, schedules multi-day tasks, has per-channel
identities and tool sets, token caps and an activity log. OpenAI Workspace Agents (Apr
2026): built once, shared, run in the cloud when nobody is active, approvals on sensitive
actions. Microsoft Autopilot (Sep 2026): a persistent teammate with its own identity,
given a role and an objective. Slack Code (Aug–Oct 2026): agent-spawned ephemeral
channels with artifacts, bookmarks, status posts and self-archive; an "Agents & tools"
hub; shareable skills. Mattermost Agents v2: *multiplayer tool calling* — three per-tool
policies (`ask` / `auto_run_in_dm` / `auto_run_everywhere`), initiator approves, result
is Share or Keep private. Standards: MCP is universal (~97M SDK downloads/month), A2A
1.0.1 is at the Linux Foundation, AG-UI 1.0 is what Blob already speaks.

Against that, **Blob's agent today answers a mention and nothing else**:

| Gap (ranked) | What the code shows |
|---|---|
| 1. Nothing proactive | No triggers, no follow/ambient mode, no scheduled-run row (a scheduled *message* with an `@` is the only way); `due_at` fires nothing; an agent cannot schedule itself |
| 2. Agents cannot call agents | A hop is fire-and-forget: the parent never gets the child's answer (`jobs/agui_outcome.py`); `ask_agent`/`run_status` exist in the MCP catalogue but are not offered in runs; bot-API tasks never dispatch |
| 3. No outbound tools | No MCP client, no `mcp_servers` table; agents get 6 of the 15 catalogue tools (`jobs/agui_tools.py`), one of which writes; `create_task`/`fetch_attachment` planned in Phase 2, absent |
| 4. Approval is one hard-coded rule | Every `post_message` asks the asker; `workspace_policies.agent_write_approval` does not exist; no pending queue, no delegate approver, no "allow for this agent here" |
| 5. Memory is an opaque 64 KB blob per conversation | No workspace knowledge, no recall tool, not editable, 90-day sweep |
| 6. No agent directory | No `/agents` view, no agent profile, `list_people` returns names only, no capability descriptions |
| 7. Cost invisible | Budget counts runs/seconds; tokens shown but never capped; no currency; LLM summary/catch-up calls uncounted; owners of personal agents see no usage |
| 8. Work channels are display-only | No artifact versions/review/apply, no publish from the UI, "paste one from the ••• menu… later" refers to UI that does not exist |
| 9. MCP server is tools-only bearer | No `resources`/`prompts`, no OAuth 2.1 → cannot be added as a claude.ai or ChatGPT connector |
| 10. Agent sees no clock or room | Context lacks date, timezone, channel topic, member list |

**Professional-communication gaps** (what a team evaluating against Slack will hit):
no SSO/OIDC/2FA/passkeys, no guests, no email beyond invites, no export/import, no
retention for messages/files, huddles have a finished backend and a disabled button,
voice notes have an upload path and no recorder/player/transcript, drafts are per
device, no custom sidebar sections, forwarding keeps no record, reminders only for self,
no edit history, no polls, link-preview images fetched and never drawn.

**Defects found while looking** (fix first, all S): original images keep EXIF GPS
(`lib/images.py`); reactions have no rate limit (`routers/messages.py`); `S3_ACCESS_KEY`
defaults to `blobadmin` with no production refusal (`config.py`); `signupPolicy` and
`banner` are parsed and used nowhere; the README's "not built" list is stale. (Two more
were reported — quiet hours leaving mentions out of the badge, and a muted channel not
badging a direct mention — and both turned out to be written product rules, `help.ts`
"Quiet hours and pausing" and "Muting is absolute". They stand; see M0's done section.)

**Engineering/platform gaps**: no Dependabot/Renovate, no pip/pnpm audit, Trivy,
gitleaks, SBOM; CI has no `permissions:` and tag-pinned actions; image never pushed to a
registry (so deploy still rebuilds tip-of-main rather than the tested image); no E2E,
axe or Lighthouse in CI; lint warnings never fail CI; no error tracking anywhere; `/readyz`
ignores S3, worker and migration head; backups are a manual `pg_dump` never drilled; no
global body cap, `/ws` relies on uvicorn's 16 MiB default; no SECURITY.md/CONTRIBUTING.md,
no release tags; `store.ts` 1,691 → 2,409 and `app.css` 7,210 → 10,822 since the Q1
"simplify" baseline. Vite 6 / vitest 2 are two majors behind (decided "not now" in W8;
unchanged).

## Strategy

Three tracks, interleaved over ~13 weeks (mid-Oct 2026 → mid-Jan 2027), **replacing
roadmap Q2 M1–M3** (its items are absorbed below, none dropped). Each milestone ships on
`main` behind its own gate; every slice is one reviewed commit with a `git revert` path.
Principles that bind every item: a person roots every chain (ADR 0013 — a trigger's
*creator* is that person), rooms are the ceiling (0017/0022), writes ask unless policy
says otherwise, Blob executes nothing an agent publishes (0007), no presence events for
apps, private channels answer 404, `lib/llm.py` stays small (it gains usage + tool calls
for summaries, not a framework), SQL stays `text()`, persist-then-broadcast.

- **Track A — Agents that work when you are away** (the headline; most of the effort).
- **Track B — The professional floor** (identity, data, voice, mail, Slack habits).
- **Track C — Trust and platform** (supply chain, E2E, telemetry, backups, security 2–3).

---

## M0 · Week 1 — Truth and small wounds (all S)

Ship before anything new, in one or two commits:

1. Defects above: EXIF location strip on originals (`lib/images.py`), reaction rate limit via
   `lib/rate_limit.py`, refuse default S3 creds when `NODE_ENV=production` (`config.py`),
   delete or wire `signupPolicy`/`banner`, fix the stale `@here` comment in
   `lib/mentions.py`, README "What isn't built yet" rewritten.
2. Global request-body cap middleware in `main.py` (pure ASGI, like `SessionMiddleware`)
   and `max_size` on `/ws` (`realtime/ws.py`); `/readyz` adds S3 probe
   (`lib/storage.probe()` exists), worker heartbeat (Redis key set by `jobs/worker.py`
   cron) and `alembic current == head`.
3. Repo hygiene: `.github/dependabot.yml` (pip, npm, actions, docker), `permissions:
   contents: read` + SHA-pinned actions in `ci.yml`, `pip-audit` + `pnpm audit
   --audit-level high` + `gitleaks` steps, `SECURITY.md`, `CONTRIBUTING.md`, annotated
   tag per release going forward, `eslint --max-warnings 0`, ruff `S` + `ASYNC` rules.
   Gate: CI green with the new steps on `main`.

## M1 · Weeks 2–5 — Agents that act without being asked (Track A)

**A1 · Triggers and follow mode (ADR 0026).** New table `agent_triggers` (agent,
workspace, channel or null, kind, spec JSONB, created_by, enabled, last_fired_at,
fire_count). Kinds: `schedule` (cron + hidden prompt — the roadmap's dropped
"scheduled run as its own row", now justified because the prompt must not be a public
message), `follow` (every new message in a channel the agent is in, with a per-channel
cooldown and a daily cap — Claude Tag's ambient mode), `event` (`task.due`,
`file.shared`, `channel.created`, `thread.unanswered` — the Phase 3 item gated on a
request; this is the request). `jobs/triggers.py` cron every minute; each firing is
`agent_chains.root` on `created_by`'s authority in the trigger's room, so nothing in
0013/0017 changes. An agent gets a `schedule_followup(when, note)` tool that creates a
one-shot `schedule` trigger owned by the asker (writes → approval). UI: "Automations"
tab on the agent page (A4) and `/remind @agent …` sugar in `services/commands.py`.
Reuse: `services/recurrence.py` (extend to cron), `services/scheduled.py` patterns,
`agent_runs.check_budget`.

**A2 · Agents that get an answer back.** Offer `ask_agent` and `run_status` in runs
(`jobs/agui_tools.py`), with the child run *awaited* inside the parent's tool round
(bounded by `AGUI_MAX_RUN_SEC` and the chain caps in `services/agent_chains.py`); the
child's final text is the tool result. `list_agents` tool returns name, description,
`plugins.capabilities` (new text column, admin-editable, forwarded as the agent's
"skills" line). Bot-API `create_task` dispatches when the assignee is an agent
(`services/task_dispatch.dispatch`). Cross-channel ask is refused unless both rooms are
in the asker's reach *and* the policy allows (`refuse_outside_the_room` stays the gate).

**A3 · Approvals as policy, not a constant (migration).** `workspace_policies.
agent_write_approval` (`always_ask` | `ask_in_channels` | `trusted`) and per-tool
`plugins.tool_policy JSONB` {tool: `ask` | `auto_in_dm` | `auto_everywhere`} — the
Mattermost model, chosen because it is the only one with a published answer to
"bot-triggered flows get only auto tools" (a trigger-fired run with an `ask` tool and
nobody present must not strand). A result's visibility: approver chooses **Share** or
**Keep private** (private → the tool result stays in the run card for the approver
only, never in the shared context). `approvals` page in `features/console/registry.ts`
(admin: all pending; `/settings`: mine) over a new `services/approvals.py` reading
`agent_runs.interrupt`. Delegate approver per channel (`channel_settings`). MCP twin:
MRTR `input_required` + signed `requestState` in `routers/mcp.py`.

**A4 · The Agents view and agent profile.** `/agents` (roadmap M2 item): every agent
with kind, status derived from `agent_runs` (idle / working in #x / waiting for you
since …), last card, Resume, Open DM. Agent profile page: description + capabilities,
tools offered and their policies, automations (A1), memory (`MemoryList.tsx`), usage
and budget, recent runs (`RunHistoryDialog` reused), owner/loans (`/allow` gains a
UI here — the one §6 leftover). Sidebar "Agents" section links to it. No presence
events: status is a read of runs.

**A5 · More Blob tools, and the clock.** `create_task`, `update_task`, `fetch_attachment`
(text/PDF via `lib/previews.py`), `summarize_thread` (reuses `services/agentic.
build_summary`), `add_reaction`, `message_person` (write → policy). `build_run_input`
adds `now` (ISO + asker's timezone), channel topic and member count to context. Tool
results stay text, 24k cap.

Gate M1: an admin sets "@janus follows #support, daily digest 08:00"; the next morning a
post appears, approved under the policy; a member asks @janus to ask @researcher and
gets one reply containing the researcher's answer; the Approvals page shows and settles
a pending write; the Agents page shows "working in #support".

## M2 · Weeks 6–9 — Reach outside Blob, and memory with a shape (Track A)

**A6 · Blob as an MCP client (ADR 0027).** `plugins/mcp_client.py`: stateless
Streamable-HTTP JSON-RPC, `lib/net.assert_outbound_url` at registration and every
call, per-server bearer or OAuth client credentials, tool allowlist, per-tool policy from
A3. `mcp_servers` admin table + console page ("Tools" under Agents & apps — this *is*
the marketplace answer from `blob-agentic-direction`). Granted tools merge into
`agent_tools` after `tools_for_agent`; every call on the run card with `via=mcp:<server>`
in `blob_tool_calls_total`. Gate: one round trip ≤ 2 s; first target Blob's own
`/api/mcp` over loopback, second a public read-only server (e.g. fetch/docs).

**A7 · MCP server for connectors.** OAuth 2.1 Authorization Code + PKCE with
protected-resource metadata and dynamic client registration (two exact `PUBLIC_ROUTES`
pairs, never a prefix); `resources` (channels, threads, files as `blob://` URIs) and
`prompts` (catch-up, summarise); `listChanged` notifications unsupported stays explicit.
Outcome: "Add Blob to Claude / ChatGPT" is a settings button producing a connector URL.

**A8 · Memory and knowledge.** `agent_notes` (agent, channel or person, body ≤ 8 KB,
editable by the owner/admin, no sweep) beside the AG-UI state blob; tools `remember`
(write → policy) and `recall(query)` over notes + thread summaries of the room via the
existing tsvector. Workspace knowledge: admin-pinned documents (`knowledge_docs`,
markdown/text attachments) searchable by `search_knowledge` — bounded by the room rule
(a doc is scoped to a channel or public). **Decision log**: `decisions` table rooted in a
message (thread or channel), `record_decision` tool (write) and a `/decision` command;
`/decisions` view and a Home card. A thread summary's "decisions" list becomes
proposals a person confirms into rows.

**A9 · Cost you can see.** `lib/llm.py` returns `Usage`; summaries/catch-up counted in
`blob_agent_tokens_total{agent="blob"}`; `model_prices` JSON setting → currency on the
meter; per-agent token budget (daily) enforced in `check_budget`; owners see their
agents' usage in `MyAgentsSection`; admin "Usage" page with per-agent/per-person tables.

**A10 · Work channels with a lifecycle.** Artifact versions (`work_artifacts.version`,
`supersedes_id`), Review (comments pinned to an artifact), Publish from the UI
(`POST /api/work/{id}/artifacts` exists), status posts and bookmarks (channel
`bookmarks` table — also a plain-channel feature), auto-archive on `finish` with a
summary card, task linkage (`work_items.task_id`). Blob still executes nothing.

Gate M2: an agent answers using a tool from an external MCP server, listed on the card;
Claude.ai connects to Blob through OAuth and reads a channel as a resource; a decision
recorded in a thread appears in `/decisions`; the budget meter shows € and refuses a run
over the token cap.

## M3 · Weeks 10–13 — The professional floor (Tracks B + C)

**B1 · Identity.** OIDC (Authorization Code + PKCE, discovery) through
`services/signup.py`'s seam; passkeys (WebAuthn) as second factor and passwordless
option; sessions page with sign-in history; step-up (re-auth) for reset links, token
minting, role changes. SAML/SCIM deferred until a customer asks. Guests: `role=guest`
limited to listed channels, no directory, no DM except with members of those channels.

**B2 · Voice.** Huddles: the top-bar button and channel-header entry (`TopBar.tsx:209`,
`ChannelView.tsx:299`), admin `HuddleSettings` UI — backend is done. Voice notes:
`MediaRecorder` in `Composer`, waveform from `AudioContext`, `<audio>` player in
`MessageRow`, transcript via an OpenAI-compatible `STT_*` endpoint (`jobs/transcribe.py`,
writes `transcript_status`); the transcript is what reaches agents and search.

**B3 · Mail and habits.** Email digest (`jobs/digest.py`, roadmap M1 spec), mention/DM
email when away ≥ N minutes (pref), server-side drafts, custom sidebar sections,
forwarding with a record (`messages.forwarded_from_id`), `/remind @person|#channel`,
edit history (`message_edits`), polls (a block type + `poll_votes`), image grid, channel
description UI, per-channel Files tab (API exists), announcement channels and an
`@channel` permission, link-preview image/site drawn.

**B4 · Data.** Export (JSONL zip, roadmap M2), Slack import (uuid7 from `ts`), message
and file retention per workspace with UI (`jobs/retention.py` extended), legal hold
flag on channels (blocks retention). Automated backups: nightly `pg_dump` to the S3
bucket from the worker + `scripts/restore-drill.sh` run quarterly; RPO/RTO in
`docs/backup.md`.

**C1 · CI that proves the product.** Playwright `apps/web/e2e/contract.spec.ts` in the
`image` job (signup → channel → send → second context sees it → thread → reaction →
search → upload → @agent run with a stub AG-UI server); axe on 16 routes; Lighthouse CI
budgets (perf ≥ 90, a11y 100); bundle budget on the app chunk. Image pushed to GHCR
tagged by SHA and Coolify deploys *that* image (closes the tip-of-main hole CLAUDE.md
names). Trivy + SBOM on the image.

**C2 · Telemetry.** OTel auto-instrumentation for FastAPI, asyncpg, redis, httpx (same
switch `OTEL_EXPORTER_OTLP_ENDPOINT`); HTTP RED metrics, WS connection gauge, DB pool,
arq queue depth on `/metrics`; client errors to `POST /api/client-errors` (rate-limited,
redacted) surfaced in the admin Health page; GlitchTip/Sentry DSN optional.

**C3 · Security phases 2–3** (the open list in memory): `/remove` rule, deleted
message's files, delivery-log redaction, unfurl regex ReDoS, push-endpoint SSRF + DNS
rebinding, `__Host-` cookie, Redis password + arq pickle hardening, source maps private,
feedback snapshot sandbox, first-signup setup token. Security page in `/admin`:
posture checklist reading live settings.

Gate M3: a colleague signs in with the company IdP and a passkey; a huddle starts from
the top bar; a voice note plays with a transcript; a nightly backup restores in the
drill; CI runs the E2E against the built image; `/metrics` shows HTTP latency.

## Janus is an external project (constraint on every item above)

Janus is the seeded agent, but it lives in its own repo and ships on its own
`JANUS_VERSION`. Blob therefore builds nothing that only Janus could use. Every new
capability here is defined at the **AG-UI 1.0 contract or the tool catalogue** — the
surface any agent (Janus, a Hermes instance, a Claude Agent SDK app, a socket-runtime
laptop agent) already speaks — and Blob's tests use the stub AG-UI server in
`tests/`, never a Janus build.

| Item | Blob alone | Needs a Janus release |
|---|---|---|
| A1 triggers / follow | yes — a fired run is an ordinary run with one new context item `trigger {kind, spec, fired_at}` | optional: Janus may read `trigger` to behave differently on a digest vs a mention; it works unread |
| A2 `ask_agent` awaited, `list_agents` | yes — tools, executed by Blob | no |
| A3 approvals policy, Share/Keep private | yes | no |
| A5 new tools and clock in context | yes | no (Janus just sees more tools and a `now`) |
| A6 Blob as MCP client | yes | no |
| A7 OAuth on `/api/mcp` | yes | no |
| A8 `remember`/`recall`, knowledge, decisions | yes — tools; the AG-UI `state` blob is unchanged | no |
| A9 usage | AG-UI 1.0 usage events already parsed in `plugins/agui.py:Fold` | only if Janus stops sending usage |
| B2 voice transcript to agents | transcript rides as a text content part (AG-UI 1.0) | no |
| Janus console page | `services/janus_console.py` is a client of Janus's `/health` and `/v1/config` and pins compatibility by version | **every Janus release that changes `/v1/config` or redaction** — keep the version check and the redaction-placeholder refusal as the contract, and record the supported range in `docs/` |

Two rules that follow: nothing in `services/seeded.py`, `services/janus_agent.py` or the
console grows a dependency on Janus internals beyond the five endpoints it already
calls; and `docs/apps.md` is updated with each new tool and context item so a
non-Janus agent author learns of it from Blob, not from Janus's changelog. Where a
Janus-side change would make a feature *better* (reading `trigger`, using `recall`
before answering), that is a note to the Janus repo, written at the end of the Blob
slice, not a blocker on it.

## After (not in this window)

UI i18n (Serbian first — after the string surface stops moving), A2A server endpoint
(only once a second A2A agent wants to talk to Blob; the `ask_agent` tool is the
internal equivalent), canvases/workflow builder (artifacts + triggers cover it),
semantic search (reopen when a workspace asks), native apps, E2EE, Matrix.

## Decisions to confirm (my recommendation first)

1. **Follow/ambient mode is in** — an agent may post unprompted in a channel it follows,
   under the creator's authority, a cooldown and the write policy. This is the first
   deliberate step past "only a person's message starts a run"; ADR 0026 records it.
2. **Approval model = Mattermost's three policies + Share/Keep private**, replacing
   the planned binary `always_ask`/`per-agent trust`.
3. **OAuth 2.1 on `/api/mcp` is worth doing now** (connectors are how people will reach
   Blob from Claude/ChatGPT), ahead of the roadmap's "only when a connector asks".
4. **This plan replaces roadmap Q2** in `docs/roadmap.md`; the Q1 counters stay as
   ratchets but the "simplify" targets for `store.ts`/`app.css` are restated honestly.
5. **Vite 8 / vitest 5** stays "not now" unless C1's Playwright work forces it.

## Verification

- Every milestone gate above, observed in a browser on both instances (`/readyz` commit).
- The existing gate on every commit: `pnpm check && (cd apps/api && uv run alembic
  check) && torsor guard --strict --severity error $(git ls-files '*.py')`, plus the new
  CI steps from M0.
- New ADRs 0026 (triggers/follow), 0027 (MCP client), and a 0028 for approvals policy;
  `tests/test_protocol_parity.py` holds any new socket events (`agent_trigger.fired`,
  `approval.pending`); `openapi.json` regenerated per commit.
- Counters: tools offered in runs 6 → ≥ 14; `blob_tool_calls_total{via="mcp:*"}` > 0 in
  prod; `/readyz` checks 2 → 5; CI jobs 4 → 7 (audit, e2e, image-publish).

---

## Done so far

M0 and M1 were released as 1.11.0 on 2026-10-19, and the Home pass as 1.11.1 the same
day. M2 is in progress on branch `m2-tools`.

### M0 — done (branch `m0-truth`)

Shipped as planned, less the two "defects" that turned out to be written product rules
(muting is absolute; quiet hours leave mentions out of the badge — both in `help.ts`).
Review found one real gap: a JPEG over the 30 MB thumbnail cap skipped the location
scrub with the thumbnail. Fixed with `storage.replace_head` — the first 5 MiB read and
cleaned, the rest copied by storage in a two-part multipart upload onto the same key —
and tested against an S3 server. The SQL-interpolation rule now counts an upper-case name
as code only when it is bound at module level, closing the bypass review pointed out.

### A5 — done

`now`, `channel_topic` and `channel_people` in every run's context; `read_file` and
`list_tasks` in the catalogue, for MCP and for agents. Both room ceilings proven by
mutation.

### A2 — done, with one item dropped

`list_agents` and `ask_agent` (awaited, `jobs/agui_delegate.py`): the question is a hop of
the same chain, admitted by its rules, on the root person's authority; the answer comes
back as the call's result. **Dropped:** dispatching tasks an app creates through the bot
API — ADR 0023 makes a hand-off a person's message, and an app is not one. `ask_agent`
covers agent-to-agent delegation.

**Review fix, and the follow-up it leaves.** The wait happens inside the asking run's
job, which holds a worker slot; eight asks at once would have held all eight while the
hops they waited for sat in the queue, stalling notifications with them. One worker now
lets at most `MAX_WAITERS` (half its slots) wait; past that the question is still asked
and answered in the room, and the asking run is told it cannot wait. The wait is 180 s.
**Next:** hold no slot at all — end the round the way a tool approval does
(`agent_runs.interrupt`, kind `agent_answer`) and resume the asking run when the hop
finishes (`_finish` enqueues the parent's resume). It needs a run status that is not
"waiting for a person" and a card that draws it, so it is its own slice.

### A3 — done as the per-agent write policy; three parts not built, on purpose

`plugins.write_approval` (migration 0054): `ask` (default, every row), `auto_in_dm`,
`auto_everywhere`, set beside tool access on the agent's console page. A post the policy
allows runs at once through the same `run_write` checks an approval would, keyed the same
way, and is counted `auto` in `blob_tool_calls_total`. Never widens where a post may go.

- **No Approvals page.** Only the person who asked may approve, and Home's "Needs a
  decision" already lists exactly theirs; an admin queue of approvals nobody but the asker
  can act on would be a list with no buttons.
- **No Share / Keep private.** Mattermost needs it because its tool results can exceed
  what the room may read. Blob's cannot: reads are bounded by the room ceiling, so a
  result is never more private than the room it lands in.
- **No delegate approver, no MCP `input_required`.** Neither has a caller yet; the review
  of 2026-10-05 reached the same conclusion for MRTR. Revisit when follow mode (A1) makes
  runs with nobody present common — those get only tools that need no approval.

### A4 — done

`/agents`: every agent the person may command, with whose it is, what it says it does and
where it stands (working, waiting for you, last ran) — read from runs through `useRunIds`,
never presence. Reached from the sidebar's Agents heading, ⌘K and the guide. Checked in
Chrome, light, dark and at 400px.

### A1 — follow mode done (ADR 0026); schedules and events as ADR 0023 left them

An admin lets an agent follow a channel it is in; a person's message there starts a run
marked not addressed — a context item says so, read tools only, no card or typing in the
room, a cooldown and daily cap in Redis that fail closed, and a silent run visible only in
the admin's run log (`agent_runs.addressed`, migration 0055). A scheduled run stays a
scheduled message that mentions an agent; event triggers and an agent scheduling its own
follow-up are not built, for the reasons ADR 0026 records.

### A6 — done (ADR 0027): Blob as an MCP client

An admin connects a server on the new MCP servers page; Blob lists its tools before keeping
it and stores them with a policy each — `off`, `ask`, `auto_in_dm`, `auto_everywhere`,
`write_approval`'s values, defaulting to `auto_everywhere` for a tool the server calls
read-only and `ask` otherwise. Granted agents are offered them as `<slug>__<tool>` beside
Blob's own tools; Blob makes every call with the server's credential, and an `ask` call
stops the run like a post, showing the person every argument. Follow runs get none.

Checked before building: the protocol moved to **2026-07-28** (stateless — no
`initialize`, no session, `Mcp-Method`/`Mcp-Name` headers, `x-mcp-header` mirroring, MRTR,
`server/discover`). The client is dual-era and hand-written, like Blob's own server: the
official SDKs support the revision, but Blob needs four calls, the network guard in front
of every request, and no task-group machinery inside a job. Gate met in tests: Blob's
client lists and calls Blob's own `/api/mcp` over the new revision in-process, and a fake
legacy server exercises the handshake, the session and its expiry.

**Not built, on purpose** (the ADR says why): OAuth — an admin's for the workspace, and
each person's own, which is what would let a write be made as the person — is the next
slice here; the client-credentials extension (a draft nobody implements), resources,
prompts, subscriptions, tasks, MCP Apps and stdio servers.

### A8, first half — the decision log (ADR 0028)

`decisions` (migration 0057): a row rooted in the message it was settled in, read under its
channel's membership, recorded by a person from a message's menu, a summary's decision or
`/decision`, revoked rather than deleted. An agent may only propose one — `record_decision`
always asks, whatever `write_approval` says, and records in the person's name with the agent
as `proposed_by`. A message carries `decisionId` from one index probe in the shared select.
A Decisions page, a Home card, a mark under the source message. Checked live through the
worker with a stub agent; the run found the message menu clipped at the foot of a
conversation (fixed in the shared `Menu`: it opens upward when there is more room there).

### A8, second half — agent notes (ADR 0024's addendum)

`agent_notes` (migration 0058): sentences an agent keeps with `remember`, finds with `recall`
and drops with `forget`, keyed as its memory is — the conversation's for the workspace's
agent, the person's for somebody's own — handed to each run as a `notes` context item, and
readable, rewordable and removable by whoever they belong to (Settings, or the agent's page
for an admin). Not offered to follow runs; swept with memory. **Not built:** workspace
knowledge documents (`search_knowledge`): nothing asks for them yet that the decision log,
notes and search do not answer.

### A7 — done (ADR 0029): Blob as a connector, by signing in

Blob is the OAuth authorization server for its own `/api/mcp`, as the MCP authorization
spec has it: the 401 names the protected resource metadata, the metadata names Blob, a
client is identified by its metadata document (or registers itself), PKCE `S256`, `iss` on
every answer, refresh tokens that rotate and end the connection when replayed. The consent
page at `/oauth/authorize` names the app, the website that confirms it (or that nothing
does), and where the answer goes — "a program on this computer" for Claude Code. A grant
mints ordinary hour-long `mcp_tokens` rows, so the endpoint did not change; Settings →
Assistants leads with the connector address, lists connected apps and keeps pasted tokens
for tools that cannot sign in; the admin's page lists both.

Checked before building: the 2026-07-28 authorization spec prefers Client ID Metadata
Documents to Dynamic Client Registration (kept, deprecated), requires RFC 8707 resource
indicators and RFC 9207 `iss`, and both Claude and ChatGPT sign in this way, with hosted
redirect URIs, while Claude Code uses a loopback one on a port it picks.

**Not built, on purpose:** `resources` and `prompts` on the MCP server (the plan's other
half of A7 — no assistant asks for them that the tools do not already answer), a 403
step-up for scope (a read-only connection is never offered a write tool), signed access
tokens, and an admin switch to forbid connecting — the lists and disconnect are the control,
as they are for tokens.

### A9 — done (ADR 0030): cost you can see

An admin's Usage page: every agent's runs and tokens over a day, a week or thirty days, the
people whose requests they answered, and Blob's own catch-ups and summaries — which now
read their provider's counts (`lib/llm.Meter`) into `model_calls`. An admin sets a
currency and a price per million tokens per model; Blob ships no price list. A model
nobody priced leaves a row "+ unpriced" rather than cheaper. An agent's budget gains a
daily token cap, checked like the others before a run, on the tokens the agent reports.
Owners see their own agents' spend in Settings → My agents. Checked live: prices turned
the seeded week into euros, the cap refused the stub's next mention in the channel through
the worker, and the owner's card showed only her agent.

**Not built, on purpose:** currency conversion, per-person caps, budget alerts and cost by
channel — nothing asks for them yet.

### A10 — done (ADR 0014's addendum): work channels with a lifecycle

An artifact published again under its title and kind is its next version (migration 0061),
whoever publishes it — so an agent iterating needs nothing new from AG-UI. Each artifact has
one thread, started by the first person to discuss or review it and told of each new
version. A person approves a version or sends it back with a note; sending back mentions
the author in the thread, which sets an agent author going on the reviewer's authority. The
tabs fold versions under one row with a picker, put Approve / Request changes / Discuss
under the version on screen, and Publish puts one in by hand. Mark done says what was made
and what was approved, in the channel and back where the work started.

**Not built, on purpose:** bookmarks and status posts (a channel feature for every channel,
its own slice), a task linked to a work item, and agents giving verdicts.
