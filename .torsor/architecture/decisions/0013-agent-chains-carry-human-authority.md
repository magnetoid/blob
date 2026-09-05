---
type: decision
status: accepted
tags: [adr, plugins, agents, protocol, authorization]
links: [0011-agui-is-an-inbound-transport, 0012-agents-may-dial-in, 0005-bots-are-real-users, 0004-persist-then-broadcast]
rules: []
---

# ADR 0013: Agents may answer each other inside a chain a person rooted, on that person's authority

## Context
[[0011-agui-is-an-inbound-transport]] settled how an agent answers a mention, and it made
one further decision almost in passing: **only a message from a person starts a run.**
That was the loop guard, and it was structural rather than a counter — two agents that
mentioned each other could not converse for ever because neither one's messages was a
trigger. It was also total. Agents in one workspace could not hand each other anything,
and an agent that stopped to ask a question (`RUN_FINISHED` with `outcome: interrupt`)
posted "Needs a decision" into a room where nothing could answer it.

The product Blob is trying to be needs both. The stated shape is a workspace agent and
members' own agents, working on one project in one room, and the owner's words were that
the agents "should be able to interact together in a chatroom discussing the project and
what needs to be done" — while a member's private agent "can only work on my command".
Slack Code shipped the first half in August 2026 as its marquee feature; AG‑UI carries the
second half natively (`RunAgentInput.resume`, `parentRunId`, `STATE_SNAPSHOT`/`STATE_DELTA`),
and A2A v1.0 has the equivalent `INPUT_REQUIRED` state. The guard had to go, and what
replaced it had to keep the two things it had been protecting: no runaway, and no agent
commanding another agent it had no right to.

## Decision

**A run belongs to a chain, and a chain is rooted in a person's message.** Three ways in:

- A person's message with no parent run **roots** a chain (depth 0). This is every run
  that existed before this decision.
- An agent's reply that mentions another agent may **extend** the chain by one hop, with
  the run that posted the reply as its parent. The hop is handed to the run job by the
  posting code itself (`_post_as_bot` enqueues `agui_run(message, parent_run)`), never by
  the ordinary send path — so a bot's message with no parent run, which is how the bot API
  posts, still starts nothing. There is no person behind it to run on the authority of.
- A person's answer to a decision an agent is waiting on **resumes** the run that asked:
  the same depth, the same chain, exactly one agent whatever else the answer mentions.

**Every hop runs on the root person's authority, never the agent's.** Whether the mentioned
agent may be commanded is asked of `initiated_by_user_id` — the person at the root —
through the same `commandable_by` an ordinary mention uses. An agent everybody can talk to
therefore cannot become a way to command an agent only its owner may. Refusal is silence,
as it is for a person, for the same reason: an owned agent's existence must not be
discoverable by watching which mentions get answered.

**A chain has a budget, and the environment is its ceiling.** `workspace_policies.
agent_chain_max_depth` (default 4, per workspace, set by an instance admin) bounds the
hops; `AGENT_CHAIN_MAX_DEPTH` in the environment caps every workspace and `0` is the
server‑wide off switch, exactly as `AGENT_RUNNER` caps hosting. Behind the depth budget
sit fixed caps that do not need a knob: twelve runs per chain, three runs per agent per
chain (the ping‑pong guard — A→B→A→B ends whatever the depth allows), and fifteen minutes
of wall clock from the root. The daily budget of [[0011-agui-is-an-inbound-transport]]'s
successor (migration 0021) still applies per hop. Every refusal here is a log line and
nothing else; a refusal card under a bot's message would be noise nobody asked for.

**Stop is Stop for the whole piece of work.** Cancelling any run marks its running
descendants cancelled too (a recursive walk over `parent_run_id`), and a hop enqueued in
the gap finds its parent stopped and never starts.

**A decision is answered by the person the chain runs on, and only them.** The interrupt's
`interrupts[]` and the folded shared state are kept on the run. Blob mints the buttons —
from the agent's declared `responseSchema` or `metadata.options`, never from its prose —
and the block union stays closed to agents. The answer is posted as the person's own
message so the channel sees a decision, not a button press; it does not root a chain of
its own (`announce(start_agent_runs=False)`), because it *resumes* the run that asked, with
`resume[]`, `parentRunId` and `state`, and those keys are present only on a resume so an
agent built on an older model does not refuse the input. A decision nobody makes within a
day becomes `expired`, a new terminal status, because "still answerable" and "nobody
answered" must not look alike in the log or on the card.

## Alternatives considered
- **Keep the guard; let a person relay.** This is what existed. It makes every hand‑off
  between agents a human's chore and makes an agent's question unanswerable.
- **A depth counter alone.** Stops the infinite case and nothing else: two agents can still
  bounce a question until the counter runs out, and the workspace agent becomes a proxy
  into every owned agent. The per‑agent cap and the root‑authority rule are what a counter
  lacks.
- **Let the agent that did the mentioning carry its own authority.** Simpler, and wrong:
  it is precisely how "agent X, listen to Marko" would stop meaning anything.
- **Answer decisions by mentioning the agent again.** What the 0011 docstring proposed.
  It loses the state the agent had, cannot name which interrupt is being answered, and
  offers no buttons — the person has to know what the agent wanted to hear.

## Consequences
- `agent_runs` gains lineage (`chain_id`, `parent_run_id`, `depth`, `initiated_by_user_id`)
  and a waiting room (`interrupt`, `state`, `decision_message_id`, `answered_at`,
  `expires_at`). A run still waiting stays in the channel's run list however old it is,
  because its buttons are still live.
- The run job has a second argument, `parent_run_id`. Lineage travels through the queue,
  not through the messages table — deriving it from `messages` alone would make every
  bot‑API post a trigger.
- `/api/interactions` branches on `agent_answer:` **before** forwarding to the message's
  plugin, or the agent is webhooked an interaction on a button it never published.
- Spend multiplies by the number of hops a chain is allowed. The budget of 0021 is the
  brake per agent; the caps here are the brake per conversation.
- 0011's "only a person's message starts a run" is qualified, not reversed: a person still
  roots every chain, and the bot API is still inert.
