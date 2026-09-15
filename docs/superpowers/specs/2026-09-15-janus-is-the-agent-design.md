# Janus is the agent Blob ships with

**Status:** design, 2026-09-15. Decided by Marko the same day: *"Remove agent Blob, that
doesn't exist anymore. Janus is the primary agent."* This retires the agent Blob ran
itself and makes Janus the one every workspace gets.

## The decision

Blob has shipped two workspace agents since 2026-09-14: its own — `plugins/builtin.py`, an
AG-UI server that never left the process, answering on the server's `LLM_*` key — and
Janus, `magnetoid/janus`, running as a service in the stack. Two agents in every sidebar,
two `@` names to learn, two configurations to keep in step, and a built-in one that was
only ever a placeholder for the real agent platform. The real one is here. The built-in
agent goes.

What that means, precisely:

* **No workspace gets `@Blob` any more.** Not at signup, not at boot. The existing rows
  are uninstalled by the deploy that carries this — bots retired the way `uninstall`
  retires them, every message they ever sent kept under a retired author.
* **Janus is seeded everywhere** (already true wherever it is configured), and the
  promise the built-in seeder made — a team gets an agentic workspace, not one they can
  bolt an agent onto — moves to it word for word.
* **The built-in runtime is deleted**, not switched off: `plugins/builtin.py`, the
  in-process transport in `plugins/streams.py`, the `builtin` runtime and the `trusted`
  install flag that existed only to admit it, and the tools it alone could use.
* **`LLM_*` stays**, for the two callers that remain: the unread recap
  (`services/catchup.py`) and thread summaries (`services/agentic.py`). `lib/llm.py`
  shrinks to what those two need — the tool-calling half of it had one caller.

## What goes with it, and why each is honest to remove

**The asker-authority tools (`jobs/agui_admission.agent_tools`).** The built-in agent
was the only agent Blob ran tools *for*: `plugins/agui.build_run_input` sends an empty
`tools` list to every external agent by design ("offering frontend tools would mean Blob
executing work on an agent's say-so; an app that wants to act already has a bot token and
scopes"). With the built-in agent gone, nothing calls tools on the asker's authority.
Janus reads and writes Blob through its bot token, bounded by its channel membership and
its scopes — a different bound, and the one every external agent already lives under.

**The `agent_reads` policy and the room narrowing (ADR 0017).** `services/mcp.py`'s
`room_channel_id`, `_refuse_outside_the_room`, `services/search.audience_channel_id`,
`workspace_policies.agent_reads`, the instance console's "What a shared agent may read"
switch and the guardrails line that reads it. All of it bounded the built-in agent's
tools; none of it touches Janus. A switch that changes nothing is worse than no switch —
the rule the console already applies to "destructive tools require a human click". ADR
0017 is superseded, not deleted: it records why the bound existed, and it returns the day
an external agent is offered Blob tools. A person's own assistant over `/api/mcp` (ADR
0016) is untouched: that credential *is* the person and was never room-bound.

**The `LLM_*`-as-agent story.** `.env.example` and the README say "set these and every
workspace gets @Blob". They will say what is true: these give the server a model for
Catch-up and summaries; the agent is Janus, and it is turned on with `COMPOSE_PROFILES`.

## What changes shape

**A DM with an agent needs no mention — for the right agents.** Today only the built-in
agent answers its DM without `@Blob` (`services/messages.addressed_by_the_room` on the
send path, `jobs/agui_admission.personal_agent_for` on the job), and the docstring says
why it was never "any bot": *widening the trigger would hand every installed third-party
app a run for every line typed at it, with no manifest opt-in.* That reasoning stands. So
the rule becomes: the room is the address when the bot is **a resident agent** —
`plugins.answers_dm_without_mention`, set only by the seeders, the way
`in_every_public_channel` is — **or the asker's own agent** (`plugins.owner_user_id` is
the one human in the room, ADR 0018). A third-party app an admin installed still needs a
mention in its DM; its contract is unchanged. A member's personal socket agent, which
today needs a mention in its own DM, no longer does: your agent answers you.

Two flags rather than one with two meanings: `in_every_public_channel` says where the
bot *is*, `answers_dm_without_mention` says how it may be *addressed*. Both are set for
Janus at install and backfilled by migration; neither is set for anything installed by
hand.

**One seeder.** `services/agent_seeding.py` was extracted this morning to hold what two
seeders shared. With one seeder left it is a module with one client: `join_public_channels`
and the boot loop fold back into `services/janus_agent.py`, and the loop's slug prefilter
— only the built-in seeder used it — goes. The tests of the loop stay, re-expressed
against Janus.

**`MENTIONABLE_AGENT`** (`plugins/registry.py`) drops the built-in runtime.
**`Listener`** loses `workspace_name` and `owner_name`, which only the built-in persona
read. **`stream_run`** loses `tools` and `call`.

## Data

Three migrations, one per task, each mirrored in `db/models.py` so `alembic check` stays
quiet at every commit:

* **0040** `plugins.answers_dm_without_mention boolean NOT NULL DEFAULT false`, backfilled
  onto the seeders' rows by the seeders' own identity.
* **0041** retires every `runtime = 'builtin'` row the way `registry.uninstall` does —
  the bot deactivated, `bot_plugin_id` cleared, its address mangled to keep
  `users_workspace_id_email_key` free, its handle released, the plugin row deleted (grants,
  secrets, tokens and deliveries cascade) — and tightens `plugins_runtime_check` to the
  four runtimes that remain. `agent_runs_transport_check` keeps `'builtin'`: the run log
  is history and the rows stay.
* **0042** drops `workspace_policies.agent_reads` and its check.

## The client

* `HomeView`'s ask box takes the first available agent rather than preferring one named
  "Blob"; its empty state already says "No agent installed yet".
* `AppsSection` loses the `builtin` access sentence and the guardrails line about what a
  shared agent reads; `AppPolicySection` loses the switch. `pnpm openapi` drops
  `"builtin"` from the runtime union and `agentReads` from the policy.
* A changelog entry says it plainly: Blob's own assistant is retired; Janus is the agent;
  old conversations with @Blob stay readable.

## Development

`docker-compose.yml` gains the same `janus` service as production, under the same
`janus` profile, so `COMPOSE_PROFILES=janus docker compose up -d` gives a developer the
agent the product now assumes. Without it a dev workspace has no agent, and the home
view says so.

## Records

* **ADR 0019 — Blob ships no agent of its own; Janus is the workspace agent.** What was
  decided, what went with it, what stays (chains 0013, work channels 0014, summaries and
  nudges 0015, assistants 0016, ownership 0018), the DM rule as it now stands, and that
  0017 is superseded.
* CLAUDE.md's digest: the intro's "like the built-in Blob and the `magnetoid/janus`
  agent", the "agent Blob runs itself" bullet and the "what a shared agent may read"
  bullet are rewritten; "eighteen ADRs" becomes nineteen.
* `.torsor/active/context.md`'s trap about `LLM_*` on the worker is reworded for the two
  callers that remain. README and `.env.example` say what `LLM_*` now does.

## Tests

Deleted with the feature: `test_builtin_agent.py`, `test_builtin_tools.py`,
`test_personal_agent.py` (its subject, the built-in agent's DM, is replaced), the
prompt-composition tests in `test_agent_chains.py`, the "built-in gets the answer as its
next turn" test in `test_agent_decisions.py`, and the tool-calling tests of `lib/llm.py`.

Written in their place, every one against a fake external agent (`tests/test_agui.py`'s
`install`, `agent_speaks`, `frame` and `route_agent_to`) or against the seeded Janus with
the same fake transport:

* `test_agent_dm.py` — the room is the address: the seeded agent answers its DM without
  a mention; mentioning it there does not answer twice; its own reply starts nothing; a
  DM between two people asks for nothing; a third member stops it; a group DM is not a
  personal room; **an app installed by hand still needs a mention in its DM**; **a
  member's own agent answers its owner without one**.
* `test_janus_agent.py` gains the acceptance test this morning's fix was written for: a
  mention in a channel founded after the seeding is answered.
* The boot-loop tests move from `test_agent_seeding.py` into `test_janus_agent.py`.

## Rollout and verification

One commit on `main` through the gate. Then on chat.imbamarketing.com and on Hadley: no
`builtin` row in `plugins`; the retired bots deactivated with their messages still
readable; a DM with Janus answered without a mention; `@Janus` in a channel founded
after the deploy answered; Catch-up and a thread summary still working on the `LLM_*`
key. The sidebar's Agents section shows Janus alone.

## Risks

* Old conversations show messages from a retired "Blob". That is the same state as any
  uninstalled app and the changelog entry names it.
* A deployment that never set `COMPOSE_PROFILES=janus` goes from one agent to none. The
  README's first section says how to turn Janus on, and the home view says when it is
  off. Both instances have it on.
