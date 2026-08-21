# Blob Comprehensive Codebase Analysis And Feature Roadmap

Date: 2026-08-21

> **Status, 2026-08-22 — Phase 0 has largely landed.** Message virtualization, the
> honest search `total`, the indexed mention lookup, the lint backlog (26 → 0) and the
> README are all done and shipped. What remains of Phase 0 is splitting `store.ts` and
> the multilingual-search *plan* (the `'english'` config is still hardcoded, and the
> implementation is a migration, not a Phase 0 item). Two defects were found while
> reviewing that work and are fixed: the mention lookup compared a Python-lowercased
> phrase against a SQL-lowercased column, which silently dropped mentions of names
> Python and Postgres lowercase differently; and message reads still selected `m.*`,
> carrying every message's tsvector to callers that discard it.
>
> Phases 1–5 below are untouched and still describe real work.

## Executive Summary

Blob is already much further along than its public-facing docs suggest. The current codebase delivers a credible Slack-class foundation with strong backend discipline and a widening set of agent-native features: transactional message writes, WebSocket realtime, full-text search, file uploads, external apps, block interactions, thread summaries, human/agent task orchestration, durable offline outbox replay, multilingual message translation, and hosted-agent deployment hooks. The architectural core is healthy and the repository gate is green: `pnpm check` passed locally on this audit run, including `329` backend tests and `50` frontend tests.

The strongest part of the system is the backend shape. The FastAPI service respects clear layering in [main.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/main.py#L123-L218), the realtime tier stays isolated from routers as intended in [hub.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/realtime/hub.py#L1-L12), and hot-path message writes preserve the "persist, then broadcast" rule in [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py#L71-L186). The CI pipeline also validates both the quality gate and the production container boot path in [ci.yml](file:///Users/magnetoid/c/blob/.github/workflows/ci.yml).

The biggest risks are no longer basic correctness. They are:

1. frontend scalability and state complexity
2. search and mention-resolution limits at larger workspace sizes
3. heuristic AI behavior that is good enough for v1 but not durable product differentiation
4. documentation drift between what the product does and what the repo says it does

The practical conclusion is: Blob does not need a rewrite. It needs a focused platform-hardening phase, followed by 4 prioritized feature investments that match the product’s long-term goals:

1. permission-aware knowledge agent and AI catch-up
2. MCP-based interoperability and packaged connectors
3. agent observability and governance
4. voice notes now, huddles only after a spike proves the operational model

## Current State Of The Codebase And Features

### What Blob actually supports today

Based on the current code, not just the README:

- Core chat, channels, DMs, threads, reactions, mentions, unread state, search, presence, and typing
- External apps with signed delivery and scoped bot APIs in [plugins.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/routers/plugins.py) and [bot_api.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/routers/bot_api.py)
- Structured blocks and interaction callbacks in [BlockRenderer.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/BlockRenderer.tsx) and [interactions.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/routers/interactions.py#L43-L94)
- Thread summaries and shared human/agent tasks in [agentic.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/agentic.py#L66-L195)
- Provider-backed message translation in [translation.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/translation.py#L119-L251)
- Durable offline queueing and replay in [store.ts](file:///Users/magnetoid/c/blob/apps/web/src/lib/store.ts) and [outbox.ts](file:///Users/magnetoid/c/blob/apps/web/src/lib/outbox.ts)
- Hosted-agent deployment via Coolify in [runner.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/plugins/runner.py#L82-L205)

### Documentation drift

The product documentation is now materially behind the code:

- [README.md](file:///Users/magnetoid/c/blob/README.md#L50-L51) still says blocks and the AI layer are not built yet.
- [docs/re_analysis_and_open_source_feature_proposal.md](file:///Users/magnetoid/c/blob/docs/re_analysis_and_open_source_feature_proposal.md) still describes `messages.blocks` as lacking a renderer, but [BlockRenderer.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/BlockRenderer.tsx) is already present.

This is a maintainability issue, not just editorial polish: stale docs create bad roadmap decisions.

## Detailed Codebase Analysis

### Architecture And Maintainability

#### Strengths

- Clear backend layering: routers delegate to services; realtime and plugins stay decoupled from routers, enforced by intent rules and reflected in [main.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/main.py#L184-L212).
- Strong transaction discipline: the message write path in [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py#L71-L186) is explicit about persistence before fan-out.
- Good operational validation: [ci.yml](file:///Users/magnetoid/c/blob/.github/workflows/ci.yml) checks typing, lint, tests, Alembic drift, image build, and production-stack boot.
- Mature backend test surface: local audit run confirmed `329 passed, 2 skipped`.

#### Maintainability concerns

1. Frontend state and message UI are becoming monoliths.
   - [store.ts](file:///Users/magnetoid/c/blob/apps/web/src/lib/store.ts) is `785` lines.
   - [ThreadPanel.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/ThreadPanel.tsx) is `519` lines.
   - [MessageRow.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageRow.tsx) is `496` lines.
   - Impact: adding features is still possible, but regression probability rises because behavior is concentrated in a few broad files.

2. The frontend lint surface is warning-heavy.
   - `pnpm check` passed, but the web lint phase reported `26` warnings.
   - The warnings are not random noise. They cluster around accessibility, React purity, and effect hygiene in [ChannelView.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/ChannelView.tsx#L25-L42), [MessageList.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageList.tsx#L84-L127), [MessageRow.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageRow.tsx#L79-L121), [CommandPalette.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/palette/CommandPalette.tsx), and modal/dialog components.
   - Impact: today this is survivable; over time it becomes UI entropy.

3. Feature and roadmap docs are stale.
   - This increases planning error and onboarding cost.

### Performance And Scalability

#### Strengths

- Realtime hub uses reverse indexes for channel and presence subscriptions in [hub.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/realtime/hub.py#L79-L118), which avoids the older workspace-wide scan problem.
- Message writes use idempotent inserts and UUIDv7 ordering in [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py#L102-L157), which is the right foundation for offline-first behavior and pagination.
- Production image boot and readiness are validated in CI, which is an unusually strong deployment baseline for an early product.

#### Current bottlenecks and limits

1. Message rendering is still non-virtualized.
   - [MessageList.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageList.tsx#L29-L129) maps the full message array into the DOM.
   - Impact: large channels will eventually hurt memory usage, scroll smoothness, and INP.
   - Severity: High.

2. Mention resolution does a workspace-wide user fetch on every send.
   - [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py#L55-L69) loads all active users in the workspace, and [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py#L89-L90) calls it during send.
   - Impact: this is acceptable for small teams, but it scales poorly as the workspace grows.
   - Severity: High.

3. Search is accurate on access control, but weak on scale and internationalization.
   - [search.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/search.py#L84-L109) hardcodes the English text search config.
   - The `total` returned in [search.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/search.py#L109-L130) is the count of limited hits, not the full match count.
   - Impact: the security boundary is right, but search UX and analytics become misleading for larger or multilingual workspaces.
   - Severity: High.

4. Client state projection does a lot of array work in the central store.
   - The outbox overlay and message projection logic in [store.ts](file:///Users/magnetoid/c/blob/apps/web/src/lib/store.ts) is correct, but it increases recomputation cost as channel histories grow.
   - Impact: not a blocker yet, but it limits future feature velocity.
   - Severity: Medium.

5. Performance measurement is mostly absent from automation.
   - The repo has strong correctness checks, but this audit found no automated Lighthouse, browser performance budget, or load test job in CI.
   - Impact: regressions in responsiveness or socket behavior will be discovered late.
   - Severity: Medium.

### Technical Debt And Functionality Gaps

| Area | Evidence | Why it matters | Priority |
|---|---|---|---|
| UI scalability | [MessageList.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageList.tsx#L96-L127) | Large channels will degrade before backend limits do | High |
| Mention scaling | [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py#L55-L69) | Send-path cost grows with workspace size | High |
| Search quality | [search.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/search.py#L92-L112) | English-only search and capped totals weaken discovery | High |
| AI quality | [agentic.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/agentic.py#L21-L28) and [agentic.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/agentic.py#L141-L162) | `heuristic-v1` is fine for baseline summaries, not for durable product value | Medium |
| Frontend purity/a11y debt | [ChannelView.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/ChannelView.tsx#L25-L42), [MessageList.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageList.tsx#L84-L127) | Quality drift is already visible in lint | Medium |
| Docs drift | [README.md](file:///Users/magnetoid/c/blob/README.md#L50-L51) | Stale docs now misdescribe shipped features | Medium |
| Feature gating by config | [config.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/config.py#L57-L83) | Translation and hosted agents exist, but operators must configure them before users can benefit | Medium |
| Huddles gap | [ChannelView.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/ChannelView.tsx#L112-L115) | Slack-familiar UX still has a visible missing surface | Medium |

## Prioritized Cutting-Edge Features

The following features were selected because they fit Blob’s domain, reuse existing architecture, and avoid forcing the product into a different category.

### 1. Permission-Aware Knowledge Agent And AI Catch-Up

**What it is**

A retrieval and recap layer that lets a user ask questions like:

- "What did we decide about the release rollback plan?"
- "Catch me up on what happened in `#ops` since yesterday."
- "Show me unresolved action items from this thread."

**Best use cases**

- async team catch-up
- cross-thread decision recovery
- reducing repeated human explanations in busy channels

**Why it fits Blob**

Blob already has:

- full-history search in [search.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/search.py)
- thread summaries and task primitives in [agentic.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/agentic.py)
- strict channel access boundaries in the service layer

This makes a permission-aware knowledge agent a natural extension, not a new product.

**Technical feasibility**

Medium-High. The main work is adding an indexed retrieval layer, likely `pgvector` plus metadata filters, and replacing heuristic summarization with model-backed structured output.

**Implementation complexity**

Medium to Large.

**Dependencies**

- optimize search and mention infrastructure first
- define event-driven indexing from message writes/edits/deletes
- add provider abstraction for model-backed summarization

**User value proposition**

Very high. This is the most direct way to make Blob materially better than a normal self-hosted team chat.

### 2. MCP Server Plus Packaged Connectors

**What it is**

Expose Blob as an MCP server and ship first-party packaged connectors for GitHub, Linear, Jira, Notion, and Google Drive using the existing app model.

**Best use cases**

- external agents reading/posting into Blob
- team automations triggered from repository, issue tracker, and docs changes
- easier "agent as teammate" workflows without bespoke app code

**Why it fits Blob**

Blob already has scoped apps, audited bot actions, and a real app callback API in [bot_api.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/routers/bot_api.py). The missing step is standardizing access for the wider agent ecosystem.

**Technical feasibility**

High. This is one of the lowest-risk feature additions because the app platform is already real.

**Implementation complexity**

Medium.

**Dependencies**

- operator-facing app templates
- OAuth and secret-management polish
- productized connector manifests and delivery diagnostics

**User value proposition**

High. This increases interoperability without changing Blob’s product identity.

### 3. Agent Observability And Governance Surface

**What it is**

An admin-facing surface for agent latency, task success/failure, delivery failures, and action audit trails, optionally exportable through OpenTelemetry-compatible traces.

**Best use cases**

- answer "what did this agent do?"
- identify failing or noisy apps
- establish trust for production agent usage

**Why it fits Blob**

Audit is already a first-class primitive in [audit.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/audit.py), and plugin deliveries already exist. Blob has the raw events; it lacks an operator-grade synthesis layer.

**Technical feasibility**

Medium-High.

**Implementation complexity**

Medium.

**Dependencies**

- standardize agent task and delivery event schemas
- define OTLP-compatible export shape
- build dashboard views in the admin console

**User value proposition**

High for serious teams, especially once more AI actions move from heuristic assistance to delegated work.

### 4. Voice Notes With Translation, Then A Huddles Spike

**What it is**

Stage this as two steps:

1. voice notes: record, transcribe, summarize, translate, post to a thread or channel
2. huddles spike: prototype Slack-like lightweight audio rooms before committing to a full rollout

**Best use cases**

- standups and field updates from mobile users
- multilingual remote teams
- capturing decisions without scheduling a meeting

**Why it fits Blob**

The UI already signals the missing huddle surface in [ChannelView.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/ChannelView.tsx#L112-L115), while file uploads and translation already exist.

**Technical feasibility**

- Voice notes: Medium-High
- Huddles: Medium-Low unless a LiveKit or mediasoup spike proves infra, TURN, and moderation fit the product’s operational budget

**Implementation complexity**

- Voice notes: Medium
- Huddles: Large

**User value proposition**

High, but only if staged carefully. Voice notes are the practical next step; huddles should not land before a deployment spike.

## Recommended Feature Prioritization

1. Permission-aware knowledge agent and AI catch-up
2. MCP server plus packaged connectors
3. Agent observability and governance
4. Voice notes
5. Huddles only after a successful spike and explicit go/no-go review

## Phased Implementation Plan

### Phase 0: Platform Hardening

Timeline: 2-3 weeks

Resources:

- 1 frontend engineer
- 1 backend engineer

Scope:

- virtualize [MessageList.tsx](file:///Users/magnetoid/c/blob/apps/web/src/features/messages/MessageList.tsx)
- split [store.ts](file:///Users/magnetoid/c/blob/apps/web/src/lib/store.ts) into message, thread, and connection slices
- fix search totals and plan multilingual search in [search.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/search.py)
- replace workspace-wide mention fetches with indexed lookup or cached prefix search in [messages.py](file:///Users/magnetoid/c/blob/apps/api/src/blob_api/services/messages.py)
- clean the existing frontend lint warnings with focus on a11y and React purity
- sync README and product docs with actual shipped functionality

Risk mitigation:

- land as small verifiable changes
- keep the current contract intact
- add focused tests before altering hot paths

### Phase 1: Open Interoperability

Timeline: 3-4 weeks

Resources:

- 1 backend engineer
- 0.5 frontend engineer

Scope:

- Blob MCP server
- packaged connector templates
- admin connector flows and diagnostics

Risk mitigation:

- reuse existing app scopes and signing model
- ship connectors one by one, not as one large batch

### Phase 2: Knowledge Agent

Timeline: 4-6 weeks

Resources:

- 1 backend engineer
- 1 frontend engineer

Scope:

- retrieval/index pipeline
- AI catch-up and recap UX
- replace `heuristic-v1` summary generation with structured model-backed output

Risk mitigation:

- keep ACL enforcement in the retrieval layer, not the prompt layer
- store model outputs separately from source messages
- gate rollout behind an operator toggle until evaluation quality is stable

### Phase 3: Agent Observability

Timeline: 2-3 weeks

Resources:

- 1 backend engineer
- 0.5 frontend engineer

Scope:

- per-agent and per-plugin health views
- task latency and success reporting
- optional OTLP export

Risk mitigation:

- redact message bodies by default in telemetry
- make tracing opt-in for self-hosted operators

### Phase 4: Voice Notes

Timeline: 3-4 weeks

Resources:

- 1 frontend engineer
- 1 backend engineer

Scope:

- device capture
- transcription pipeline
- translated transcript posting
- thread/channel insertion UX

Risk mitigation:

- stage with provider abstraction
- treat original audio as an attachment, not a special message type
- collect operator feedback before any huddles work starts

### Phase 5: Huddles Spike

Timeline: 1-2 weeks for spike only

Resources:

- 1 engineer with realtime/media experience

Scope:

- deployability test with LiveKit or mediasoup
- TURN/UDP requirement mapping
- moderation and audit model
- browser/device matrix

Decision gate:

Proceed only if the spike proves acceptable operational cost for self-hosted teams.

## Success Metrics

### Platform metrics

- `pnpm check` stays green on every phase
- frontend lint warnings reduced from `26` to `<5`
- p95 channel-open render time improves after virtualization
- no regression in offline replay correctness

### Feature metrics

#### Knowledge agent

- at least 25% of weekly active users invoke catch-up or Q&A within 30 days of launch
- answer citation click-through rate above 40%
- zero ACL-bypass incidents

#### MCP and connectors

- at least 3 packaged connectors installed in 30% of active workspaces
- connector delivery success above 99%

#### Agent observability

- 100% of agent-initiated actions visible in the admin surface
- mean time to diagnose failing plugin deliveries reduced by 50%

#### Voice notes

- 15% of weekly active users record at least one voice note in the first 60 days
- p95 transcription time under 5 seconds for short clips

## Recommended Next Steps

1. Approve Phase 0 as the immediate workstream.
2. Treat documentation correction as part of the engineering work, not a follow-up.
3. Start with interoperability and knowledge features before realtime media.
4. Do not commit to huddles until a deployment spike proves the self-hosted runtime model.

## Final Review

These recommendations were reviewed against Blob’s actual constraints:

- self-hosted, open-source product
- Slack-familiar UX expectations
- backend-first architectural rules
- one-image deployment simplicity
- no destructive rewrite of the existing client/server contract

The roadmap is practical because it builds on primitives Blob already has. The platform does not need speculative moonshots. It needs one platform-hardening phase, then a sequence of features that amplify its strongest differentiator: agents and humans working in the same conversation under the same permissions.

## External Research Sources

- Linux Foundation A2A adoption announcement: https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
- Agentic AI Foundation on A2A + MCP stack: https://aaif.io/blog/a2a-joins-aaif
- Airtable enterprise agent platform evaluation: https://www.airtable.com/articles/best-enterprise-ai-agent-platforms-2026
- Atlan knowledge-base and governed RAG analysis: https://atlan.com/know/llm-knowledge-base-tools/
- Slack AI meeting notes and huddles overview: https://slack.com/intl/zh-my/blog/productivity/ai-meeting-note-taker-how-it-works-and-features-to-look-for
- LangChain observability tool survey: https://www.langchain.com/resources/llm-observability-tools
- Datadog AI agent observability overview: https://www.datadoghq.com/knowledge-center/ai-agent-observability/
- Datavlab sovereign AI guide: https://datavlab.ai/post/sovereign-ai-european-enterprises-practical-2026-guide
