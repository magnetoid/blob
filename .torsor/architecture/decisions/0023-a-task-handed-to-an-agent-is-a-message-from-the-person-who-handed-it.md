---
type: decision
status: accepted
tags: [adr, agents, tasks, scheduling, agui, authorization]
links:
  [
    0004-persist-then-broadcast,
    0013-agent-chains-carry-human-authority,
    0018-an-agent-is-the-workspaces-or-a-persons,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
  ]
rules: []
---

# ADR 0023: A task handed to an agent is a message from the person who handed it

## Context

A task could be assigned to an agent's bot, and nothing happened. The row changed and the
agent was never told, so the work waited until somebody mentioned the agent — the very
thing assigning it was meant to replace. Only admins could do even that, under a rule
("only admins can assign work directly to an agent") older than agents having owners
([[0018-an-agent-is-the-workspaces-or-a-persons]]).

The review of 2026-10-05 put proactive runs third: an agent should be able to start from
something other than a line typed at it. Three triggers were proposed — a task handed to
it, a schedule, and workspace events — and each has to answer the question
[[0013-agent-chains-carry-human-authority]] asks of every run: on whose authority?

## Decision

**A task handed to an agent posts a hand-off: a message from the person who handed it,
addressed to the agent, in the task's thread.**

- **The hand-off is the trigger.** Assigning a task to an agent — creating it that way, or
  reassigning it — posts `@Agent — a task for you: **title**` with the instructions below,
  as the person who assigned it, in the thread the task belongs to. It takes the ordinary
  path: it roots a chain on that person's authority, the agent answers under it, and the
  run card, Stop, decisions and Blob's tools ([[0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first]])
  work exactly as they do for a mention. The room sees who asked the agent for what.
  Nothing about running an agent is new; only the trigger is composed rather than typed.
- **It mentions the agent and nobody else.** The message's mentions are set outright
  rather than parsed from the text, so a name in the task's title cannot notify anyone or
  set a second agent going, and the agent is reached whatever its name looks like.
- **The rules of a mention, asked up front.** The person must be allowed to command the
  agent in that channel (`agent_access.MAY_COMMAND`) — the workspace's agent, their own,
  or one lent to them — and to post there; the agent's bot must be in the channel and
  able to answer. This replaces "admins only" for agents: a member who may set an agent
  going with a mention may hand it a task, and an admin may not command somebody's own
  agent by assigning it work any more than by mentioning it. A mention that breaks a rule
  is dropped in silence, because the room can see nothing happened; an assignment that
  breaks one is refused with the reason, because somebody picked that agent from a list.
- **The run is told the task.** A `task` item in the run input's `context` carries its
  id, title, instructions, priority and due date, beside the hand-off that says the same
  in words.
- **How the run ends moves the task**, in the transaction that records the ending: an
  answer marks it done, with the answer (cut to 2,000 characters) as its outcome; a run
  that ended having said nothing, failed, was refused — over budget, agents switched off,
  no longer able to post — or asked a question nobody answered in time blocks it with the
  reason; Stop puts it back to do; a question leaves it in progress until it is answered.
  Only a task still in progress, still with that agent and still on that hand-off
  (`agent_tasks.dispatch_message_id`, the chain the run is on) moves, so a run finishing
  behind a person's own decision never overwrites it. A task that changes hands drops its
  hand-off.
- **Two saves are a hand-off, and no others.** The task changing hands to an agent, and
  an agent's task moved back to in progress — "work on it again", the retry for a task its
  run blocked, and a fresh hand-off with a chain of its own. Saving anything else about a
  task an agent holds, its priority or its outcome, does not set the agent going.
- **An app hands nothing over.** A task an app creates or reassigns through the bot API
  starts no run: an app's message has no person behind it to run on the authority of.
  An app's bot that is not an agent may still be assigned work by an admin, as before,
  and hears of it through the task events.

**A scheduled run is a scheduled message that mentions an agent.** The scheduler already
repeats daily, on weekdays and weekly, and a scheduled message is its author's own when it
sends, so it already roots a chain on their authority. A separate row for scheduled runs
was considered and not built: the run would still need a person's message at its root,
and a second scheduler would be a second place for every rule here to be forgotten. The
Scheduled list says which of its messages are runs.

**Event triggers are not built.** An agent woken by `channel.created` or `file.shared` has
no person at its root, and none of the answers above applies. It waits for a request that
says what it is for.

## Consequences

- Migration 0048 adds `agent_tasks.dispatch_message_id`, set by the hand-off and cleared
  when the task changes hands; `services/task_dispatch.py` holds the rules, the hand-off
  and the settling.
- `messages.send` takes `mention_user_ids`, for a message Blob composes on someone's
  behalf.
- A `task.updated` socket frame tells the room a task changed, by anyone; the thread panel
  refetches its tasks on it, which is how a task shows done the moment its agent answers.
- The thread panel offers people, and the agents the person may hand work to that are in
  the room. An app's bot that is not an agent is no longer in that picker; an admin can
  still assign one through the API.
- `GET /api/agents` says `mine` only for an agent the caller owns; one lent to them was
  labelled theirs.
