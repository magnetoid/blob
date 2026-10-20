---
type: decision
status: accepted
tags: [adr, product, agents, cost]
links:
  [
    0003-hand-tuned-sql-stays-sql,
    0013-agent-chains-carry-human-authority,
    0025-what-an-operator-can-see-of-agents,
  ]
rules: []
---

# ADR 0030: What agents cost is counted, not measured

## Context

An admin deciding whether an agent is worth what it costs had runs and minutes, which Blob
measures, and a token count on each run, which it did not use. Every 2026 workspace-agent
product shows spend per agent and per person and lets an admin cap it (Claude Tag's token
caps, OpenAI's workspace agent usage, Slack's per-seat limits). Blob's earlier rule was that
tokens are "shown, never capped", because they are the agent's provider's count rather
than Blob's. AG-UI 1.0 now carries them, per provider and model, on every run's last event,
and Blob's own two model features — the catch-up and thread summaries — had no count at all.

## Decision

**Spend is what was reported, priced by the workspace. Blob counts; it does not measure,
and it says so wherever a number appears.**

- **Two sources, both somebody else's count.** An agent's tokens are its `RUN_FINISHED`
  `usage` (kept on `agent_runs.usage` as before). Blob's own model calls read the provider's
  counts into `model_calls` — feature, model, who asked, input and output tokens, and none
  of what was sent or answered. A failed call that was paid for is counted.
- **Money is the workspace's arithmetic.** An admin sets a currency and, per model, a price
  per million input and output tokens (`workspace_settings.usage`). Blob ships no price
  list: one would be wrong by the next release and wrong for anyone on a contract. Cost is
  tokens times price, model by model; a model nobody priced, or an entry that gave only a
  total, leaves the cost **partial and labelled so** — never zero.
- **A token cap, on the agent's own count.** `plugins.budget_tokens_per_day` sits beside
  the run and minute caps and is checked by the same `check_budget`, over the same trailing
  day, before a run starts. It binds only an agent that reports tokens, and the field says
  so; the run that crosses it finishes. This replaces "never capped": the count is still
  the agent's, but an admin who wants to stop a runaway agent now has the number the agent
  itself gives.
- **Who sees what.** The Usage page (`/admin/usage`) is any admin's: every agent, the people
  whose authority runs were on (`initiated_by_user_id`, the chain's root — ADR 0013), Blob's
  own features and the models seen. An owner sees their own agents' spend in Settings and
  nothing of anybody else's. Windows are a day, a week and thirty days — runs are kept
  thirty, and `model_calls` is swept on the same day.

## Consequences

- Migration 0060; `lib/llm.Meter` (Anthropic's cumulative stream counts; OpenAI's and
  DeepSeek's `stream_options.include_usage`, asked for only where the endpoint is known to
  accept it); `services/usage.py`, `routers/usage.py`; the metric
  `blob_agent_tokens_total{agent="blob"}` for Blob's own calls.
- `docs/apps.md` tells an agent author to report tokens per model, split into input and
  output, so they can be priced and capped.
- Not built: currency conversion, per-person caps, alerts when a budget nears its end, and
  cost by channel. Each waits for someone to need it.
