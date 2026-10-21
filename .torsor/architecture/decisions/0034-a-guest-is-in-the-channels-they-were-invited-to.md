---
type: decision
status: accepted
tags: [adr, security, people, channels]
links:
  [
    0031-a-persons-sign-in-is-the-addresss,
    0013-agent-chains-carry-human-authority,
    0022-an-agent-may-use-blobs-tools-inside-the-room-and-writes-ask-first,
  ]
rules: []
---

# ADR 0034: A guest is in the channels they were invited to, and nowhere else

## Context

A team working with a client or a contractor needs them in a room or two without handing
them the workspace: every public channel, the directory, the agents. Slack's answer is
guests — single- and multi-channel. Blob had three roles, all of which read every public
channel and saw everybody, so "invite them to #project" meant "let them read #general".

## Decision

**`guest` is a fourth role. A guest sees the channels their invitation named — and later
ones somebody adds them to — the people in those channels, and nothing else.**

- **Invited by name, into rooms.** A guest invitation needs an address and at least one
  channel; a private channel can be named only by an admin who is in it
  (`invites.channel_ids`). The guest joins those channels, not the default ones. The owner
  can make a member a guest or a guest a member from People; a member made a guest keeps
  the channels they were in and loses every assistant they had connected.
- **"Public" means public to members.** Every query where `kind = 'public'` lets a channel
  open itself to a viewer who has not joined it says `AND NOT` the viewer is a guest
  (`db/visibility.VIEWER_IS_GUEST`), and `assert_channel_access` treats a public channel a
  guest is not in as private — 404, so even its name is not confirmed. Search, files and
  decisions were already bounded by membership.
- **People are the people in their rooms.** The bootstrap's users, `GET /api/users`, one
  person, and presence answer a guest only about themselves and whoever shares a channel
  with them (`db/visibility.GUEST_SEES`). A guest may open a DM only with those people;
  anybody may write to a guest.
- **Nothing that reaches past their rooms.** A guest cannot make a channel, add people,
  join or browse public channels, mint an MCP token, approve an assistant or attach an
  agent of their own. Their socket hears no workspace-wide broadcast. And a guest's
  message starts no agent run: a run acts with its asker's reach through tools written
  for members — the directory, every public channel (ADR 0022) — and a guest's reach is a
  handful of rooms. Agents still answer the members in those rooms.

## Consequences

- Migration 0066 (`users.role`, `invites.role`, `invites.channel_ids`); `db/visibility.py`
  holds the two rules so the services and the socket, which may not import the services,
  say them the same way.
- The client hides what a guest cannot use — browsing, new channels, agents — and the
  invitation form offers the channels this admin can see.
- Not built: an end date on a guest's account (Slack's time limit), single-channel guests
  as a separate kind, a visible "guest" mark beside a guest's name in conversations, and
  letting a guest use agents through a narrower tool set.
