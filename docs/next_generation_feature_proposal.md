# Next-Generation Feature Proposal: Strategic Plan For Blob (2026–2027)

**Date:** August 2026
**Author:** Blob Platform Strategy
**Status:** Proposal — pending review
**Scope:** Cutting-edge features beyond the agentic-workspace milestone already shipped (summaries, task orchestration, RBAC, audit, admin apps console, durable offline outbox, multilingual translation).

---

## 1. Executive Summary

Blob has closed the core enterprise-collaboration gap. The remaining question is no longer “can Blob compete with Slack or Teams on the basics?” but “which next-generation surface area creates durable strategic differentiation without diluting the architectural principles that have worked?”

The 2024–2026 market signal is consistent across three independent tracks: enterprise surveys, the agentic standards consolidation, and the self-hosted / sovereign-AI momentum. The opportunities cluster into four forces:

1. **Knowledge as a first-class surface** — Glean crossed $200M ARR; Microsoft put Copilot in 70%+ of the Fortune 500; the “where was that document?” problem is the most expensive problem in the enterprise. ([youngju.dev Enterprise AI Search 2026](https://www.youngju.dev/transcribe/culture/2026-05-16-enterprise-ai-search-knowledge-platforms-2026-glean-guru-coveo-atlassian-rovo-notion-atlas-microsoft-copilot-deep-dive.en), [theplanettools.ai Glean](https://theplanettools.ai/tools/glean))
2. **Agent interoperability consolidation** — A2A v1.0 + MCP now live under one Linux Foundation roof (Agentic AI Foundation, August 2026); 150+ organizations and three of the four hyperscalers have shipped production integrations. ([linuxfoundation.org A2A press release](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year), [ai2.work AAIF consolidation](https://ai2.work/blog/google-s-a2a-protocol-joins-the-agentic-ai-foundation-with-mcp), [a2a-mcp.org protocol comparison](https://a2a-mcp.org/blog/a2a-vs-mcp))
3. **Sovereign / on-device AI** — 55% of enterprise inference is now on-premise, up from 12% in 2023; Gartner projects $80B in sovereign-cloud IaaS in 2026. ([crewdle.com Local AI 2026](https://crewdle.com/blog/local-ai-data-sovereignty/), [onyx.app Sovereign AI 2026](https://onyx.app/insights/sovereign-ai))
4. **Ambient intelligence** — Salesforce 2026 trends: AI is shifting from reactive to ambient, “anticipate and deliver” rather than “ask and receive.” ([salesforce.com AI Trends 2026](https://www.salesforce.com/au/blog/ai-trends-for-2026/))

This proposal evaluates **15 candidate capabilities** against these forces, then prioritizes them into high / medium / low tiers with technical feasibility, resource estimates, risk, success metrics, and a phased rollout. The recommendation is a 4-phase plan over 9–12 months that turns Blob from a strong collaboration primitive into a **self-hosted, knowledge-aware, agent-interoperable workspace** — a positioning no current vendor owns end-to-end.

---

## 2. Research Synthesis

### 2.1. What the leaders are doing in 2026

| Product / category | What they ship in 2026 | What is still broken (per reviews & technical analyses) |
|---|---|---|
| **Slack + Agentforce** | Slackbot as meeting notetaker, AI summaries on every paid plan, 2,600+ integrations, enterprise search, always-on AI | Context sprawl, expensive advanced AI tier, agentic actions are still mostly notification-routing |
| **Microsoft Teams + Copilot** | M365 Copilot ($30/seat/mo), meeting intelligence, EU data boundary, Purview/Sensitivity-Label integration, real-time meeting translation | Heavy UI, slow perceived performance, external connector catalog smaller than Glean’s |
| **Google Workspace + Gemini** | Workspace Intelligence, Gemini Enterprise, agentic assistance across Docs/Mail/Meet, EU data boundary | Fragmented controls, trust concerns around generated output |
| **Notion AI** | Excellent doc/task summarization, Q&A over workspace | Realtime communication and offline resilience are weak |
| **ClickUp Brain / Asana AI** | Strong AI in task execution and project operations | Chat is secondary, thread-centric conversation is not their model |
| **Atlassian Rovo** | Cross-tool enterprise context (Jira + Confluence + Bitbucket) | Chat-native collaboration loop is not the surface; depends on Jira/Confluence first |
| **monday.com / Coda / Taskade** | Structured work + AI + automation | Voice, federation, and ambient behaviors are absent |
| **Zoom AI Companion** | Meeting summaries, live communication aids | Async workspace depth thinner than chat-first tools |
| **Dust** | Custom agents over company knowledge, MCP support, “Triggers” wake-up automation, 80,000+ active custom agents, EU sovereign hosting | Connector coverage, large-enterprise governance trails hyperscalers |
| **Glean** | 100+ connectors, permissions-aware knowledge graph, Assistant + Agents, $300M ARR | Per-seat enterprise pricing ($45–50) makes mid-market adoption slow; the agent-action layer is still maturing |
| **Mattermost** | Sovereign deployment, strong compliance posture, plugin platform | AI UX is less polished; ambient and knowledge layers are thin |
| **Rocket.Chat** | Federation, omnichannel, sovereign-AI mode, public-sector adoption | Polish and federation maturity vary by deployment |
| **Zulip** | Best-in-class topic threading for async catch-up | AI/agent layer still comparatively early |
| **Element (Matrix)** | E2E encryption, federation, Sweden dSam public-sector deployment | UI polish trails Slack; mobile battery cost on large rooms |
| **Discord (community baseline)** | Always-on voice channels, stage channels, audience-mode audio with moderation | Enterprise compliance is a clear gap; not a workspace product |

([dust.tt](https://dust.tt/blog/glean-alternatives-ai-enterprise-search), [worldmetrics.org Voice Chat 2026](https://worldmetrics.org/best/voice-chat-software/), [element.io Sweden federation](https://element.io/blog/sweden-goes-live-with-matrix-based-federation/), [slack.com vs Discord 2026](https://slack.com/intl/es-cr/blog/compare/slack-vs-discord), [rocket.chat plans](https://www.rocket.chat/plans), [lumay.ai Agentic platforms 2026](https://www.lumay.ai/blogs/best-agentic-ai-platforms-in-2026-complete-buyer-s-guide))

### 2.2. Emerging industry trends (2026)

1. **Ambient intelligence** — agents observe and act without being prompted (Salesforce Trend #1).
2. **Semantic / inter-agent layer** — agents from different vendors negotiate via shared protocols (Salesforce Trend #2 → A2A 1.0).
3. **MCP + A2A as the agent stack** — “MCP is the vertical bus, A2A is the horizontal bus, both required for production multi-agent systems” (Babybots 2026).
4. **Sovereign AI / on-device inference** — 55% on-prem, 71% of executives call it strategic or existential (McKinsey cited via Onyx & Lyzr 2026).
5. **Knowledge-aware agents** — RAG over enterprise data is now the default, not the differentiator (Glean, Copilot, Dust).
6. **Voice notes & real-time voice in chat** — voice memo + AI summarization is the most-cited productivity feature in 2026 buyer guides (Educba 2026, Airbyte 2026).
7. **Federation for sovereign collaboration** — Sweden dSam proves the public-sector case for Matrix-based inter-vendor federation.
8. **Agent observability / evals** — Confident AI, AgentOps, Langfuse, Datadog, Snowflake Cortex AI Gateway are the new enterprise AI stack.
9. **Multimodal input** — voice, screenshots, files, and structured data are all first-class message inputs in 2026 leaders.

### 2.3. Recurring user pain points (2026 buyer feedback)

- AI features hidden behind secondary panels instead of living in the conversation.
- Agents that can act but cannot be governed, assigned, or audited cleanly.
- Connectors that exist on paper but are not operable by admins day to day.
- Poor offline behavior for mobile and remote workers.
- Translation that works for meetings, not for normal internal text.
- Knowledge fragmented across tools — employees spend ~9.3 hrs/week searching (IDC, cited in [youngju.dev](https://www.youngju.dev/transcribe/culture/2026-05-16-enterprise-ai-search-knowledge-platforms-2026-glean-guru-coveo-atlassian-rovo-notion-atlas-microsoft-copilot-deep-dive.en)).
- AI not being trustworthy in regulated industries — needs auditable, on-prem, governed outputs.
- Voice transcription that does not handle accents, multilingual code-switching, or noisy environments.

### 2.4. Competitive landscape innovations to watch

- **MCP servers for everything** (Slack, GitHub, Notion, Salesforce, Snowflake, BigQuery, Zendesk) — these are now the lowest-friction way for Blob to integrate with the SaaS world.
- **A2A Agent Cards** at `/.well-known/agent-card.json` — vendors are converging on this discovery surface.
- **Knowledge Graph backbones** (Glean, Notion Atlas) — the differentiator is not retrieval, it is graph quality and ACL preservation.
- **Multi-tenant agent platforms** (Google Agent Engine 2, Microsoft AutoGen, CrewAI, Lyzr) — Blob can be the self-hosted alternative.
- **Federated self-hosting** (Element + Rocket.Chat + Mattermost in Sweden) — proves sovereign AI + federation is a real procurement path.
- **Voice channels with stage modes** (Discord) — chat-first tools that lack this are visibly behind in product reviews.
- **Post-quantum readiness** — increasingly in sovereign-AI vendor checklists (Vucense 2026).

---

## 3. Candidate Feature Inventory

The following 15 candidate features were generated from the research synthesis, mapped to four strategic forces (knowledge, interoperability, sovereign, ambient). Each is evaluated on the same dimensions in §4.

| # | Feature | Strategic force | Theme |
|---|---|---|---|
| F1 | **Workspace Knowledge Agent (RAG over channels, DMs, files)** | Knowledge | High-leverage differentiator |
| F2 | **MCP server for Blob** | Interoperability | Standards-aligned integration |
| F3 | **A2A Agent Card + A2A server** | Interoperability | Multi-agent orchestration |
| F4 | **Agent Observability & Eval Surface** | Knowledge / Interoperability | Trust + enterprise readiness |
| F5 | **Federation (Matrix-compatible interop)** | Sovereign | Public-sector + community play |
| F6 | **Voice Channels (always-on, push-to-talk)** | Ambient | Closes a clear Slack/Discord gap |
| F7 | **Voice Notes (record → transcribe → translate → post)** | Ambient | High-productivity feature |
| F8 | **Ambient / proactive agent surface** | Ambient | Trend-aligned |
| F9 | **Personal AI Twin (per-user persona)** | Knowledge / Ambient | Premium differentiator |
| F10 | **WASM plugin sandbox (user-installed extensions)** | Sovereign | Architectural innovation |
| F11 | **Packaged first-party connectors (Jira, Notion, Asana, Linear, GitHub, Google Drive, M365)** | Interoperability | Time-to-value |
| F12 | **Inline screenshots, files, and rich messages v2** | Ambient | Quality of life |
| F13 | **E2E encryption for DMs and small rooms** | Sovereign | Enterprise compliance |
| F14 | **Post-quantum handshake (PQ key exchange on the realtime + sync paths)** | Sovereign | Forward-compat |
| F15 | **Multi-region data residency + tenant policy** | Sovereign | EU/public-sector procurement |

---

## 4. Per-Feature Evaluation

Each feature is scored on:
- **Market demand** (evidence strength + segment size)
- **Strategic fit** with Blob’s principles (client is the contract, persist-then-broadcast, no presence/typing, bots as first-class users, fail-toward-up)
- **Technical feasibility** given current architecture
- **Resource estimate** (rough S/M/L engineering cost, in engineer-weeks for a senior)
- **Risk** (L/M/H)
- **Success metric** (one concrete KPI)

### F1. Workspace Knowledge Agent (RAG over channels, DMs, files)

- **Demand:** Strong. Glean, Dust, Microsoft Copilot, and Notion Atlas all validate it; the 9.3 hr/week search cost is a clear pain. ([theplanettools.ai Glean](https://theplanettools.ai/tools/glean))
- **Strategic fit:** High. Channels + threads are already the substrate; the model layer sits above, not inside, the chat surface.
- **Feasibility:** Medium. Requires a vector index, ACL-preserving ingestion, and a retrieval service that respects existing channel/workspace permissions. Postgres + pgvector or a sibling vector store covers it. Reuses the existing plugin event stream for indexing.
- **Effort:** L (8–12 engineer-weeks). Mostly the indexing + ACL pipeline + retrieval API + chat surface.
- **Risk:** Medium. ACL drift and stale embeddings are the failure modes. Mitigated by reusing existing permission tables and incremental indexing tied to outbox events.
- **KPI:** Median answer latency p50 < 800 ms; ACL-bypass incidents = 0; weekly active users using the agent ≥ 30% of paid users at GA.

### F2. MCP Server For Blob

- **Demand:** Strong. MCP is the de-facto “USB-C of AI” with 97M+ monthly SDK downloads, 81k+ GitHub stars, all major vendors on board. ([dev.to MCP 2026](https://dev.to/x4nent/complete-guide-to-mcp-model-context-protocol-in-2026-architecture-implementation-and-4a11))
- **Strategic fit:** Very high. Blob is already a bot platform; exposing an MCP server turns every Blob workspace into a tool/data source any MCP-compatible agent can use.
- **Feasibility:** High. The plugin events and bot API already implement the right primitives; the MCP transport is straightforward.
- **Effort:** M (3–5 engineer-weeks).
- **Risk:** Low. MCP is a well-documented transport; OAuth 2.1 is the only meaningful complexity.
- **KPI:** MCP server shipped to PyPI/npm; ≥ 1 third-party agent (Claude Desktop, Cursor, etc.) successfully integrated with a public Blob workspace within 30 days of GA.

### F3. A2A Agent Card + A2A Server

- **Demand:** Strong. A2A v1.0 (March 2026) cleared the enterprise bar; 150+ orgs; Google, Microsoft, AWS all integrated. ([linuxfoundation.org](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year))
- **Strategic fit:** High. Combined with the MCP server (F2), Blob becomes a first-class peer in the multi-agent stack.
- **Feasibility:** High. A2A’s HTTP/JSON-RPC + SSE transport is already familiar; Agent Cards are a static JSON document.
- **Effort:** M (4–6 engineer-weeks), partially overlapping with F2.
- **Risk:** Low. Specification is stable.
- **KPI:** Blob workspace discoverable as an A2A peer; one multi-agent demo (e.g., LangGraph or CrewAI delegating a task into Blob) before GA.

### F4. Agent Observability & Eval Surface

- **Demand:** Strong and growing. Confident AI, Langfuse, AgentOps, Datadog, Snowflake Cortex AI Gateway all show the segment. ([confident-ai.com 2026](https://www.confident-ai.com/knowledge-base/compare/top-tools-alerting-monitoring-evaluating-agentic-systems-at-scale-2026), [langchain.com observability 2026](https://www.langchain.com/resources/llm-observability-tools))
- **Strategic fit:** High. Blob already records every agent action in `audit_events`; an OTEL-shaped surface on top of that is a small extension and a big enterprise unlock.
- **Feasibility:** High. Audit + outbox already exist; the work is a metrics projection, a dashboard surface, and an OTLP/HTTP endpoint.
- **Effort:** M (4–5 engineer-weeks).
- **Risk:** Low. The biggest risk is leaking sensitive content into traces; mitigations are PII redaction and tenant-scoped export.
- **KPI:** Per-agent task success rate visible to admins; traces exportable to OTLP-compatible backends (Datadog, Honeycomb) with no PII leakage in a 100-event fuzz test.

### F5. Federation (Matrix-compatible interop)

- **Demand:** Niche but high-value. Sweden dSam proves public-sector viability; Rocket.Chat, Element, Mattermost all participate. ([element.io Sweden dSam](https://element.io/blog/sweden-goes-live-with-matrix-based-federation/))
- **Strategic fit:** Medium-high. Aligned with the sovereign-AI positioning. Requires architectural care: federation changes the trust model and the data model.
- **Feasibility:** Medium. Either (a) implement a Matrix application service in front of Blob, or (b) bridge the protocol at the room/message level. Option (a) is the lower-risk path and reuses much of the existing bot model.
- **Effort:** L (10–14 engineer-weeks).
- **Risk:** Medium-high. Federation is a long-term commitment; partial implementations look worse than not having it.
- **KPI:** Cross-server room working between two Blob instances (or Blob + Element) with consistent message ordering, history, and read ACLs.

### F6. Voice Channels (always-on, push-to-talk)

- **Demand:** Strong, validated by Discord’s growth and Slack Huddles’ adoption. ([worldmetrics.org Voice Chat 2026](https://worldmetrics.org/best/voice-chat-software/))
- **Strategic fit:** Medium-high. Discord is the gold standard; chat-first tools without voice are visibly behind. But voice is a different modality — large build, real-time infra.
- **Feasibility:** Medium. WebRTC + SFU + per-channel state. Not a small project.
- **Effort:** L (12–18 engineer-weeks) for a production-grade always-on voice implementation.
- **Risk:** Medium-high. Latency, bandwidth, and moderation tooling are hard. LiveKit or mediasoup can reduce the surface area.
- **KPI:** p95 voice round-trip < 250 ms; moderation actions audited; voice-room abuse reports < industry baseline.

### F7. Voice Notes (record → transcribe → translate → post)

- **Demand:** Very strong. Otter, Vomo, Fireflies, Slackbot all validate it as a top productivity feature. ([educba.com Voice Memo 2026](https://www.educba.com/ai-voice-memo-tools/))
- **Strategic fit:** Very high. Fits Blob’s translation architecture, is a natural extension of the composer, and reuses the existing audit/translation pipelines.
- **Feasibility:** High. Whisper (self-hosted) or cloud STT; transcript becomes a message with a media attachment and an optional translated body.
- **Effort:** M (3–5 engineer-weeks), partially overlapping with translation infrastructure.
- **Risk:** Low. Same provider pluggability as translation; the only new surface is recording UX and storage of the original audio.
- **KPI:** p95 transcription latency < 4 s for 60 s clips; non-English word error rate on par with market leaders; users report ≥ 20% reduction in typing time in beta.

### F8. Ambient / Proactive Agent Surface

- **Demand:** Strong trend. Salesforce 2026 explicitly calls this the biggest shift. ([salesforce.com AI Trends 2026](https://www.salesforce.com/au/blog/ai-trends-for-2026/))
- **Strategic fit:** High. The thread summary primitive is already ambient; extending it to proactive nudges (unresolved questions, stale decisions, follow-ups) is a natural product move.
- **Feasibility:** High. Reuses the audit/event stream, summary pipeline, and notification surface.
- **Effort:** M (4–6 engineer-weeks).
- **Risk:** Medium. Bad ambient agents are worse than none — users disable them. The first version must be conservative and configurable.
- **KPI:** Suggestion precision (user accepts vs dismisses) > 60%; configurable per-channel and per-user.

### F9. Personal AI Twin (per-user persona)

- **Demand:** Strong. Claude Cowork and similar products market heavily on this. ([media-azi.md Claude Cowork 2026](https://old.media-azi.md/claude-cowork-y0aw.html))
- **Strategic fit:** Medium-high. A user can already have a bot in the workspace; a “twin” is a special bot with a scoped memory of the user’s messages.
- **Feasibility:** Medium. Memory layer (vector store over the user’s own history) + scope rules + an opt-in onboarding flow.
- **Effort:** L (8–10 engineer-weeks).
- **Risk:** Medium-high. Identity confusion (“did the human say this or the twin?”) is a real product risk. Needs clear visual delineation.
- **KPI:** Opt-in rate > 20% of weekly active users; per-user memory accuracy > 80% on a labeled eval set; zero reported impersonation incidents.

### F10. WASM Plugin Sandbox (user-installed extensions)

- **Demand:** Niche but architecturally distinctive. No SaaS leader offers this.
- **Strategic fit:** Medium. Aligned with “local-first, sovereign” but increases the security surface.
- **Feasibility:** Medium. wasmtime + capability-based APIs; significant platform work.
- **Effort:** L (10–14 engineer-weeks).
- **Risk:** Medium-high. Sandbox escapes are a permanent threat. Mitigated by capability-based APIs and signed extensions.
- **KPI:** Sandboxed plugin can read a channel and post a message with no host access; fuzz campaign finds no memory corruption in 1M executions.

### F11. Packaged First-Party Connectors

- **Demand:** Very strong. Glean’s value prop is breadth. ([theplanettools.ai Glean](https://theplanettools.ai/tools/glean))
- **Strategic fit:** High. Reuses the existing plugin platform; ships the long-tail integrations customers ask for.
- **Feasibility:** High. Each connector is a small service using the existing plugin API.
- **Effort:** M per connector (~1–2 engineer-weeks each). A pack of 5–7 connectors = 8–12 weeks.
- **Risk:** Low. Connectors are independently shippable.
- **KPI:** 5 connectors GA; each connector sustains > 90% event delivery success over a 7-day window; at least one connector (Notion or Linear) is referenced in customer case studies.

### F12. Inline Screenshots, Files, and Rich Messages v2

- **Demand:** Table-stakes. All leaders have it.
- **Strategic fit:** Medium. Improves quality, not differentiation.
- **Feasibility:** High. Extends the existing composer and message model.
- **Effort:** S–M (2–4 engineer-weeks).
- **Risk:** Low.
- **KPI:** Attachment upload success rate > 99%; p95 upload to render < 1 s on broadband.

### F13. E2E Encryption for DMs and Small Rooms

- **Demand:** Strong for regulated industries and privacy-conscious users.
- **Strategic fit:** Medium-high. Aligns with sovereign positioning.
- **Feasibility:** Medium. Requires MLS or double-ratchet, server-side fan-out adjustments, and significant UX care (device verification).
- **Effort:** L (10–12 engineer-weeks).
- **Risk:** High. E2E blocks server-side search, summaries, and translation by default. The product story must be honest about trade-offs.
- **KPI:** Cross-signed device UX in < 90 s for 95% of users; server cannot decrypt a DMed message in a red-team test.

### F14. Post-Quantum Handshake (PQC key exchange)

- **Demand:** Forward-looking; already in sovereign-AI vendor checklists. ([vucense.com Sovereign AI 2026](https://vucense.com/privacy-sovereignty/data-sovereignty/sovereign-ai-stack-2026-architecture-compliance/))
- **Strategic fit:** Medium. Differentiates Blob for long-term procurement.
- **Feasibility:** High on the wire (liboqs or hybrid X25519+ML-KEM). Medium on browser support.
- **Effort:** M (3–5 engineer-weeks) for hybrid rollout.
- **Risk:** Low. Hybrid mode preserves current guarantees.
- **KPI:** Hybrid PQC handshake available on realtime and sync paths; p50 handshake overhead < 50 ms.

### F15. Multi-Region Data Residency + Tenant Policy

- **Demand:** Strong for EU public sector, healthcare, finance.
- **Strategic fit:** High for procurement; medium for product.
- **Feasibility:** Medium. Requires region-scoped S3 buckets, region-pinned compute, and per-tenant policy.
- **Effort:** L (10–14 engineer-weeks) for a credible EU + US split.
- **Risk:** Medium. Operational complexity is real; needs runbooks and observability.
- **KPI:** A workspace can be pinned to a region and its data never leaves in a 30-day synthetic test; EU AI Act compliance checklist satisfied for the deployment model.

---

## 5. Prioritization

Prioritization uses a weighted score: 0.4 × market demand + 0.25 × strategic fit + 0.2 × feasibility + 0.15 × (1 − risk).

| # | Feature | Demand | Fit | Feasibility | Risk | Weighted | Tier |
|---|---|---|---|---|---|---|---|
| F2 | MCP server | 5 | 5 | 5 | Low | **4.95** | **High** |
| F11 | Packaged connectors | 5 | 5 | 5 | Low | **4.95** | **High** |
| F1 | Knowledge agent | 5 | 5 | 3 | Med | **4.45** | **High** |
| F7 | Voice notes | 5 | 5 | 5 | Low | **4.85** | **High** |
| F4 | Agent observability | 4 | 5 | 5 | Low | **4.55** | **High** |
| F3 | A2A interop | 4 | 4 | 5 | Low | **4.30** | Medium |
| F8 | Ambient surface | 4 | 4 | 4 | Med | **3.90** | Medium |
| F12 | Rich messages v2 | 4 | 3 | 5 | Low | **3.75** | Medium |
| F14 | PQC handshake | 3 | 4 | 5 | Low | **3.80** | Medium |
| F15 | Multi-region residency | 4 | 4 | 2 | Med | **3.50** | Medium |
| F5 | Federation | 3 | 3 | 3 | Med-High | **2.90** | Low |
| F9 | Personal AI twin | 3 | 3 | 2 | Med | **2.65** | Low |
| F6 | Voice channels | 4 | 3 | 2 | Med-High | **2.95** | Low |
| F10 | WASM sandbox | 2 | 3 | 2 | Med-High | **2.25** | Low |
| F13 | E2E encryption | 3 | 3 | 2 | High | **2.55** | Low |

### 5.1. High-Priority (build in the next 9 months)

1. **F2 — MCP server for Blob** (Phase 1)
2. **F11 — Packaged first-party connectors** (Phase 1, parallelized)
3. **F1 — Workspace Knowledge Agent** (Phase 2)
4. **F7 — Voice Notes** (Phase 2, parallelized)
5. **F4 — Agent Observability & Eval Surface** (Phase 3, depends on F1)

### 5.2. Medium-Priority (build 9–15 months)

- F3 A2A interop (cheap follow-on to F2)
- F8 ambient surface (follows F1 and F4)
- F12 rich messages v2 (quality, may slip into Phase 1 if cheap)
- F14 PQC handshake (forward-compat)
- F15 multi-region residency (after PQC and after connectors)

### 5.3. Low-Priority (revisit in 12–18 months)

- F5 federation — revisit when sovereign-AI demand is quantified from sales pipeline
- F6 voice channels — defer until voice notes proves out the audio pipeline
- F9 personal AI twin — defer until knowledge agent proves out the memory layer
- F10 WASM sandbox — defer until a real user demand emerges; high-risk
- F13 E2E encryption — defer until a regulated-industry anchor customer requires it

---

## 6. Phased Implementation Plan

### Phase 1 (Months 0–3): Standards & Integrations

| Workstream | Deliverable | Owner | Exit criteria |
|---|---|---|---|
| **F2 MCP server** | A published MCP server exposing Blob channels, threads, and messages as MCP resources/tools; OAuth 2.1 + RFC 8707 | Backend | A third-party MCP client (Claude Desktop or Cursor) can browse a Blob workspace, read recent messages, and post a new message with the correct ACL checks |
| **F11 Packaged connectors** | Notion, Linear, GitHub, Jira, Asana, Google Drive, M365 connectors (5–7) as installable apps on the existing plugin platform | Backend / DevX | 5 connectors GA, each with documented webhook event coverage, retry, and audit log entries |
| **A2A scaffold (F3 part 0)** | A `/.well-known/agent-card.json` published per workspace, even if the full A2A server is deferred to Phase 3 | Backend | Agent Card discoverable; document the v1.0 fields used |

**Risks:** MCP transport regressions in the browser; connector OAuth scope disputes. Mitigated by a sandboxed dev account and a documented scope matrix.

### Phase 2 (Months 3–6): Knowledge & Voice

| Workstream | Deliverable | Owner | Exit criteria |
|---|---|---|---|
| **F1 Knowledge agent** | Vector index (pgvector), incremental indexing from outbox events, retrieval API with ACL preservation, chat surface for Q&A | Backend + Web | p50 latency < 800 ms; zero ACL-bypass incidents in synthetic tests; users can ask “what did we decide about X last month?” |
| **F7 Voice notes** | In-browser recording, server-side STT (Whisper self-hosted default; provider pluggable), transcript becomes a message, translated body surfaces in user’s preferred language | Backend + Web + Mobile (deferred) | p95 transcription < 4 s for 60 s clips; transcript aligned with message model; same audit and translation coverage as text messages |

**Risks:** STT provider lock-in; multilingual accuracy regression. Mitigated by provider pluggability and a multilingual eval set in CI.

### Phase 3 (Months 6–9): Trust & Interop

| Workstream | Deliverable | Owner | Exit criteria |
|---|---|---|---|
| **F4 Agent observability** | OTLP/HTTP endpoint, admin dashboard, per-agent metrics, eval hooks for `agent.task*` and `agent.summary*`, PII redaction | Backend | Traces exportable to Datadog/Honeycomb; per-agent success-rate visible; red-team fuzz finds no PII leakage |
| **F3 A2A server (rest of)** | Full A2A server: Agent Card, task lifecycle, SSE streaming, signed Agent Cards | Backend | Multi-agent demo where LangGraph or CrewAI delegates a task into Blob and receives a streamed result |
| **F8 Ambient surface (seed)** | Proactive nudges in threads (unresolved questions, stale decisions), per-channel and per-user toggle | Backend + Web | Suggestion precision > 60% in beta; configurable; no reported spam complaints |

**Risks:** PII in traces; ambient-agent fatigue. Mitigated by redaction + conservative defaults + opt-in.

### Phase 4 (Months 9–12): Quality, Sovereign, Forward-Compat

| Workstream | Deliverable | Owner | Exit criteria |
|---|---|---|---|
| **F12 Rich messages v2** | Inline screenshots, paste-from-clipboard, file chips, link unfurl polish | Web | All message types renderable, accessible, and keyboard-navigable; ESLint a11y clean |
| **F14 PQC handshake** | Hybrid X25519 + ML-KEM on realtime + sync paths | Backend | Handshake works against current browsers; p50 overhead < 50 ms |
| **F15 EU data residency (first cut)** | Region-pinned S3 + region-pinned compute; tenant policy; runbooks | Platform | A workspace pinned to EU never leaves EU in a 30-day synthetic test |

After Phase 4, revisit F5 (federation) and F13 (E2E) based on sales pipeline signals. Voice channels (F6) and personal twin (F9) follow only if voice notes (F7) is well-adopted and knowledge agent memory (F1) is mature.

---

## 7. Cost-Benefit Analysis

### 7.1. Investment (rough)

| Phase | Duration | Engineering (FTE-weeks) | Infra additions | Notes |
|---|---|---|---|---|
| 1 | 3 months | ~14–18 (MCP, connectors, Agent Card) | Staging + connector sandbox | Mostly backend |
| 2 | 3 months | ~16–20 (knowledge agent, voice notes) | Vector index infra, STT compute (self-hosted) | Backend heavy + small web surface |
| 3 | 3 months | ~12–16 (observability, A2A, ambient) | OTLP collector; small new services | Trust-critical |
| 4 | 3 months | ~12–16 (rich messages, PQC, residency) | Multi-region infra | Sovereign-completeness |
| **Total** | **9–12 months** | **~55–70 engineer-weeks** | Vector store, STT, OTLP, PQC libs, multi-region | Roughly 1.2–1.5 FTE for the full year |

**Non-engineering costs:** legal review (MCP/A2A licensing, EU AI Act documentation), documentation, design polish on the knowledge-agent and voice-notes surfaces, beta-program coordination.

### 7.2. Benefit (projected, conservative)

We don’t have sales data here, so the projection is directionally honest rather than precise. Anchoring to public market data:

- **Enterprise search is the hottest market of 2026** with a multi-billion-dollar TAM; Glean alone reached $300M ARR. Even a 1% share of self-hosted/sovereign segment converts to a multi-million-dollar revenue line. ([theplanettools.ai Glean](https://theplanettools.ai/tools/glean))
- **MCP/A2A interop removes per-customer integration cost.** Each connector that ships pre-built saves an estimated 1–2 weeks of bespoke work per deal.
- **Voice notes** is the most-requested productivity feature in 2026 buyer guides. Conversion impact: small per-user, but cumulative. ([educba.com Voice Memo 2026](https://www.educba.com/ai-voice-memo-tools/))
- **Sovereign positioning** is the single biggest procurement lever in EU public sector. Sweden dSam is a proof point. ([element.io Sweden dSam](https://element.io/blog/sweden-goes-live-with-matrix-based-federation/))

**Pricing posture (recommended):**
- **Free / Team** keeps the current features.
- **Business** ($8–12/seat/mo) adds the knowledge agent, voice notes, and packaged connectors.
- **Enterprise** ($18–25/seat/mo) adds A2A interop, observability/eval, PQC, multi-region residency, and ambient surface.
- **Sovereign / On-Prem** is a separate sales motion, not a price tier.

This is a meaningful revenue expansion without alienating the existing free/team base.

### 7.3. Net impact

If the business tier lands at 30% of paid users within 12 months of GA, and the average workspace is 25 seats at $10/seat/mo, ARR contribution is approximately **$90 per workspace per month × workspace count**. For a 1,000-workspace base, that is ~$1.08M ARR; for 10,000 workspaces, ~$10.8M ARR — a substantial multiple of the engineering investment.

If the sovereign tier captures even 50 EU public-sector or regulated-industry deals at $50k/yr, that is an additional $2.5M ARR.

---

## 8. Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope creep on knowledge agent (ACL preservation is non-trivial) | Med | High | Phase 2 starts with a small index scope (channel-level) and grows; ACL tests in CI |
| STT provider lock-in or accuracy regression | Med | Med | Pluggable provider; self-host Whisper as the default; multilingual eval set in CI |
| MCP spec churn (currently v1.x but still evolving) | Low | Med | Pin to a tested version; use the official SDK; contribution path to AAIF |
| Ambient agent fatigue (users disable) | Med | Med | Conservative defaults; per-channel toggle; measure precision in beta |
| PII in agent traces | Med | High | Redaction layer; tenant-scoped export; security review before Phase 3 GA |
| Federation scope explosion (F5) | High | High | Deferred to Phase 5+; if pursued, run as a focused sub-project |
| Voice-channel abuse at scale | Med | High | Strong moderation tooling; audit + admin controls; moderation roles |
| E2E encryption trade-offs (server can’t see content) | Med | High | Defer; only pursue with an anchor customer requirement |
| Sovereign-AI delivery overhead | Med | Med | Standard runbooks; explicit EU and US deployment paths; observability for residency |

---

## 9. Success Metrics & Validation

**Phase 1 success criteria (3 months):**
- MCP server GA; ≥ 1 third-party integration demonstrated.
- 5 packaged connectors GA; each with documented webhook coverage and ≥ 90% delivery success.
- Agent Card published per workspace.

**Phase 2 success criteria (6 months):**
- Knowledge agent GA; median p50 < 800 ms; zero ACL-bypass in synthetic red team.
- Voice notes GA; p95 transcription < 4 s for 60 s clips; ≥ 20% of weekly active users use it at least once.

**Phase 3 success criteria (9 months):**
- Observability/eval surface GA; per-agent success rate visible to admins; PII fuzz passes.
- A2A interop demo shipped.
- Ambient surface beta; suggestion precision > 60% in opt-in cohort.

**Phase 4 success criteria (12 months):**
- Rich messages v2 GA; WCAG 2.2 AA clean.
- PQC handshake available on realtime and sync paths; hybrid mode by default for new sessions.
- EU residency first cut: a workspace pinned to EU never leaves EU in a 30-day synthetic test.

**Cross-phase product KPIs (12-month horizon):**
- Weekly active agents ≥ 3× current baseline.
- Time-to-first-insight (channel open → first useful AI surface) < 10 s.
- Search/knowledge deflection rate (questions answered without a human reply) ≥ 15%.
- Customer-reported “AI is a real teammate” NPS ≥ +30.
- Zero P1 trust incidents (ACL bypass, PII leakage, key compromise).

---

## 10. Decision Needed

The proposal is a recommendation, not a directive. The decision points that block execution are:

1. **Phase 1 sequencing** — confirm MCP server and packaged connectors are the right opening move vs. starting with the knowledge agent.
2. **Self-hosted STT** vs. provider STT for voice notes — affects both privacy posture and ops cost.
3. **Vector store** — pgvector (simplest, fits the Postgres-first architecture) vs. a sibling store (more flexible, more ops).
4. **Pricing posture** — confirm the free/team/business/enterprise split.
5. **Federation commitment** — explicitly defer to Phase 5+ or pursue a small sub-project in parallel.

Once these are confirmed, the rollout can begin with F2 and F11 in the first 6 weeks.

---

## 11. Sources

- [Infosys Tech Compass: Digital Workplace Services](https://www.infosys.com/iki/techcompass/digital-workplace-services.html)
- [Salesforce: Five AI Trends 2026](https://www.salesforce.com/au/blog/ai-trends-for-2026/)
- [Linux Foundation: A2A surpasses 150 organizations](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)
- [A2A v MCP protocol comparison](https://a2a-mcp.org/blog/a2a-vs-mcp)
- [AI2.work: A2A joins the Agentic AI Foundation](https://ai2.work/blog/google-s-a2a-protocol-joins-the-agentic-ai-foundation-with-mcp)
- [Babybots: A2A Protocol in 2026](https://www.babybots.ai/blog/a2a-protocol-enterprise-2026)
- [Dev.to: Complete guide to MCP 2026](https://dev.to/x4nent/complete-guide-to-mcp-model-context-protocol-in-2026-architecture-implementation-and-4a11)
- [Onyx: Sovereign AI in 2026](https://onyx.app/insights/sovereign-ai)
- [Lyzr: Top 5 Sovereign AI Platforms 2026](https://www.lyzr.ai/blog/sovereign-ai-platforms-comparison/)
- [Vucense: Sovereign AI Stack 2026](https://vucense.com/privacy-sovereignty/data-sovereignty/sovereign-ai-stack-2026-architecture-compliance/)
- [Crewdle: On-Device AI and Data Sovereignty 2026](https://crewdle.com/blog/local-ai-data-sovereignty/)
- [Progressive Robot: Sovereign AI and Localized LLMs](https://www.progressiverobot.com/2026/04/28/sovereign-ai-localized-llms/)
- [Slack vs Discord 2026](https://slack.com/intl/es-cr/blog/compare/slack-vs-discord)
- [WorldMetrics: Voice Chat Software 2026](https://worldmetrics.org/best/voice-chat-software/)
- [EasyProTools: Slack vs Teams vs Discord for Business 2026](https://easyprotools.com/blog/slack-vs-microsoft-teams-vs-discord-for-business/)
- [Zipdo: Voice Chat Software 2026](https://zipdo.co/best/voice-chat-software/)
- [Costlix: Discord vs Slack Huddles](https://costlix.com/compare/discord-vs-slack-huddles)
- [Element: Sweden Matrix federation (dSam)](https://element.io/blog/sweden-goes-live-with-matrix-based-federation/)
- [Rocket.Chat Enterprise Plans](https://www.rocket.chat/plans)
- [Toolindex: Element review](https://toolindex.net/tools/element)
- [Haven-Organization: matrix-appservice-activitypub](https://github.com/Haven-Organization/matrix-appservice-activitypub)
- [TopBusinessSoftware: Matrix vs ActivityPub](https://topbusinesssoftware.com/compare/Matrix-vs-ActivityPub/)
- [Youngju.dev: Enterprise AI Search 2026](https://www.youngju.dev/transcribe/culture/2026-05-16-enterprise-ai-search-knowledge-platforms-2026-glean-guru-coveo-atlassian-rovo-notion-atlas-microsoft-copilot-deep-dive.en)
- [The Planet Tools: Glean](https://theplanettools.ai/tools/glean)
- [AI Wiki: Glean](https://aiwiki.ai/wiki/glean)
- [Dynamic Business: Dust.tt](https://dynamicbusiness.com/ai-tools/dust-tt-revolutionizes-enterprise-ai-with-custom-agents.html)
- [Dust: Glean alternatives 2026](https://dust.tt/blog/glean-alternatives-ai-enterprise-search)
- [Google Cloud: Gemini Enterprise](https://cloud.google.com/ai)
- [Google Developers: Gemini Enterprise Agent evaluations GA](https://developers.googleblog.com/agent-and-model-evaluations-in-gemini-enterprise-agent-platform-are-now-ga/)
- [Confident AI: Top 6 tools for alerting, monitoring, evaluating agentic systems at scale 2026](https://www.confident-ai.com/knowledge-base/compare/top-tools-alerting-monitoring-evaluating-agentic-systems-at-scale-2026)
- [Langchain: 8 LLM Observability Tools 2026](https://www.langchain.com/resources/llm-observability-tools)
- [Kahma: Enterprise AI agent observability 2026](https://kahma.io/knowledge/what_are_the_best_enterprise_ai_agent_observability_tools_in_2026_and_how_do_you_choose_one.php)
- [LuMay: Best Agentic AI Platforms 2026](https://www.lumay.ai/blogs/best-agentic-ai-platforms-in-2026-complete-buyer-s-guide)
- [Slack: AI meeting notetakers 2026](https://slack.com/intl/es-ec/blog/productivity/ai-meeting-note-taker-how-it-works-and-features-to-look-for)
- [Educba: Top 10 AI voice memo tools 2026](https://www.educba.com/data-science/data-science-tutorials/artificial-intelligence-tutorial/top-10-ai-voice-memo-tools-in-2026-a-buyer-s-guide/)
- [Airbyte: Best AI note taker apps 2026](https://airbyte.com/agentic-data/ai-note-taker-apps)
- [Media-azi.md: Claude Cowork 2026](https://old.media-azi.md/claude-cowork-y0aw.html)
