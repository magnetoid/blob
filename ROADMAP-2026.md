# Blob 2026/2027 Strategic Roadmap

## Core Architectural Principles (Preserved)
- **Agent-Native:** Agents are first-class citizens (real `users` rows).
- **Persist-then-broadcast:** Real-time events never outpace the database source of truth.
- **Slack-Familiarity:** High-end UX with zero learning curve for enterprise users.

## Phase 1: Agentic Execution (Q3 2026)
*Transitioning from agents that talk to agents that do.*
1. **Integrated Previews:** Deepen `Preview.tsx` to support multi-step tool calls and sandboxed environments (e.g., WebContainers).
2. **Actionable Artifacts:** Extend AG-UI to allow agents to generate interactive mini-apps that persist in the channel.
3. **Standardized Code Channels:** Formalize "Work Channels" where a channel maps directly to a repository or branch for autonomous coding.

## Phase 2: Architectural Scaling (Q4 2026)
*Strengthening infrastructure for enterprise demands.*
1. **Supabase Hybrid Integration:** Leverage Supabase for Storage and Edge Functions to handle high-latency agent tasks, maintaining hand-tuned SQL in FastAPI for chat performance.
2. **Presence CRDTs:** Evolve presence tracking to use CRDT-based state synchronization for resilient collaborative editing.
3. **UUIDv7 Keyset Optimization:** Optimize message loading logic to handle multi-workspace event streams without client-side lag.

## Phase 3: Cognitive Relief & UX (Q1 2027)
*Differentiating through high-end design and reduced context switching.*
1. **Staggered Transition System:** Implement motion design in `app.css` using staggered entries for channel loading to reduce perceived latency.
2. **Zero-Friction Meetups:** Enhance Meetups with automatic transcription and action-item extraction feeding into the Work history.
3. **Editorial UI Refinement:** Shift toward refined, editorial layouts prioritizing deep focus using elevation and motion tokens.

---
*Generated via automated codebase and market analysis.*
