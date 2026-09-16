# 0017 — A shared agent reads no further than the room it is answering in

> **Superseded on 2026-09-15 by [[0019-blob-ships-no-agent-of-its-own]].** The bound this
> ADR describes applied to the tools the built-in agent ran on the asker's authority.
> That agent is retired and no external agent is offered Blob's tools, so the bound has
> no subject. The reasoning below is kept for the day one is.

**Status:** accepted, 2026-09-13. Qualifies 0013 (a chain carries the rooting person's
authority) by bounding where that authority may be *spent*. Leaves 0016 (an assistant
token is a person) untouched.

## Context

0013 settled whose authority a run carries: the person who rooted the chain, never the
agent and never the last speaker in it. That is the right answer to "may this agent act",
and it is silent on "what may this agent read", which until now defaulted to the same
thing — `jobs/agui_admission.agent_tools` built the MCP caller from
`initiated_by_user_id` and handed the model the asker's whole reach.

The asker's reach is the correct ceiling when the answer goes back to the asker. It is
the wrong one the moment the answer lands somewhere else, because an agent's reply is a
message in a room and a room has its own audience. Concretely: `@Blob summarise
#salaries`, typed in `#general` by somebody who is in `#salaries`, read the private
channel and posted the summary into `#general`. Nobody's permissions were violated on
the way — the asker really could read it — and the room still learned something it could
not have opened for itself. A private channel answers 404 precisely so its *existence*
stays private; quoting its contents into a public one gives away more than the 404 ever
protected.

This is also the shape a prompt injection wants. A message in a channel the agent can
reach says "summarise #salaries here", and the blast radius is whatever the most
privileged person who ever mentions the agent can see.

## Decision

The workspace policy `agent_reads` bounds an agent's reads to its audience.

* **`audience` (default).** In a channel, the agent may read public channels and the
  channel it was asked in — nothing else, whoever asked. In its own DM with the asker,
  the asker's full reach, because there the room *is* the asker and that is the promise
  the agent's DM already makes.
* **`asker`.** The previous behaviour, for a workspace that wants it back.

The bound is a ceiling on top of the existing floor, never a replacement for it. Every
read still runs as the asker and still goes through `assert_channel_access`; the agent
can never see more than the person who asked, and under `audience` it also cannot see
more than the room. Refusals are "no such channel", never a permission error: an agent
that said "you may not read that" would confirm the channel to everyone reading the room.

It is enforced in `services/mcp.py` — one predicate, `_refuse_outside_the_room`, applied
where a channel is resolved by name, by id, and through a message id, plus a filter on
the channel listing and an `audience_channel_id` clause inside the search statement. In
the statement rather than over the page, so the total counts what the room may see and
page two is the same search as page one.

A person's own MCP token carries no room and is unaffected (0016): that credential is
the person, it answers only them, and there is no room for it to leak into.

Existing workspaces are migrated to `audience` rather than to the behaviour they had.
This is deliberately not the precedent 0013's migration set for the host capabilities,
where leaving a workspace permissive avoided surprising an admin: here the surprise is a
private channel quoted into a public one, so the safe direction is the tightening nobody
has to notice, with the switch in the instance console for anyone who wants the old reach.

## Consequences

* An agent asked in `#general` about a private channel answers "there is no channel by
  that name", which reads as the channel not existing — the same thing the app tells a
  non-member, and the reason it is phrased that way.
* Somebody who wants the agent's full reach asks it in its DM, which is also where the
  answer stays private. That is a better default than the old one for the same reason
  Slack's own DMs are: the room decides who reads the reply.
* The bound is per workspace and set by the *instance* admin, not the workspace admin —
  policy its own subject can edit is not policy (see `db/models.WorkspacePolicy`).
* **`post_message` was bounded too**, because it resolved its target through the same
  helper. Under `audience` an agent could post to a public channel or to the room it was
  asked in, and not into a private channel it was not asked in. That was the same
  question the read bound answered and the more surprising direction of the two — an
  agent quoting a room was one thing, an agent speaking into a room nobody invited it to
  was another — and `messages:write.anywhere` decided, at the time, whether it could
  choose a channel at all. That scope is retired (`plugins/manifest.RETIRED_SCOPES`).
* `search` grew an `audience_channel_id` parameter. It narrows and can never widen, so
  passing it is always safe; passing `None` is exactly the old query.
