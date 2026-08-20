# Post-Implementation Feedback Framework

Date: 2026-08-20

## Objective

Measure whether the new agentic workspace capabilities are actually improving coordination, comprehension, and trust.

Covered capabilities:

1. thread summaries
2. human/agent task orchestration
3. apps admin console
4. durable offline outbox
5. multilingual translation

## Primary Success Metrics

1. Summary adoption rate
   - `% of active threads where a summary is generated`
2. Task orchestration adoption
   - `% of active work threads with at least one task`
3. Translation adoption
   - `% of active multilingual users who request or auto-show translations`
4. Offline recovery success
   - `% of queued messages successfully replayed after reconnect`
5. Admin integration operability
   - median time to install and validate an app

## Quality Metrics

1. translation cache hit rate
2. translation provider failure rate
3. agent task completion latency
4. summary refresh latency
5. failed delivery count per installed app

## User Satisfaction Prompts

Use a short in-product survey after the feature has been used at least three times.

1. Thread summaries help me catch up faster.
2. Shared tasks make handoffs between people and agents clearer.
3. Message translation makes multilingual collaboration easier.
4. Offline sending feels reliable when my connection is unstable.
5. The Apps admin screen makes integrations understandable and operable.

Scale:

1. strongly disagree
2. disagree
3. neutral
4. agree
5. strongly agree

## Qualitative Follow-Up Questions

1. Where did the AI help most?
2. Where did it create extra review work?
3. Which translation results felt wrong or risky?
4. Which app-management steps still felt unclear?
5. What did you still have to leave Blob to do?

## Recommended Review Cadence

1. Weekly during rollout: translation failures, app delivery failures, offline replay issues
2. Biweekly: adoption metrics and satisfaction scores
3. Monthly: priority review for next medium-priority capabilities

## Decision Thresholds

1. If translation provider failures exceed 2% of requests, prioritize provider observability and retry policy.
2. If offline replay success is below 99%, treat it as a release blocker.
3. If task adoption is high but completion latency is rising, prioritize workload and agent observability.
4. If app installs cluster around support tickets, prioritize packaged connectors and setup templates.
