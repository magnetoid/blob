---
type: decision
status: accepted
tags: [adr, agents, channels, security, client]
links: [0013-agent-chains-carry-human-authority, 0007-user-content-is-data-never-code, 0011-agui-is-an-inbound-transport, 0005-bots-are-real-users]
rules: []
---

# ADR 0014: Work is a private channel with a record attached, and an artifact is data — a page runs only in a sandbox, only on request

## Context
A thread is where a piece of work gets decided and a poor place for the work itself. An
agent asked to build something answers at length, its diffs scroll past, a preview has
nowhere to live, and the people who should review it are reading #general. Slack shipped
"Slack Code" for exactly this in August 2026: a channel created from a conversation,
carrying the context forward, where people and agents work one assignment and the agents
publish artifacts the team reviews in tabs — the plan, the diffs, a running preview.

Blob had every part except the container: chains ([[0013]]) so agents can hand work to
each other, decisions that resume, memory, ownership, run cards. What it lacked was a
place for one assignment and a way to show what the agents made. Two decisions were
needed, and the second is the one with teeth.

## Decision

**A work channel is an ordinary private channel with a `work_items` row.** No fifth
channel kind. Everything a channel does — threads, mentions, `/allow`, Stop, archive,
search, the sidebar — works unchanged, and the row is what tells the client to draw tabs.
It is started from a message: the new channel quotes the message and links to it, the
source thread gets a link forward, the named agents are added, and a kickoff message *from
the person* mentions them — so the chain it roots is the person's, with the person's
authority ([[0013]]). An agent only its owner may command cannot be brought into somebody
else's work, for the same reason a hop cannot reach it; refused with a sentence at the
moment of starting rather than silently on every later mention, because a room that looks
staffed and is not is the worse failure. Finishing marks the row done and archives the
channel: the history stays, the sidebar stays a list of things still happening. The
starter or an admin finishes it — archiving is otherwise admin-only, and stays so.

**An artifact is data ([[0007]]).** Agents publish over AG‑UI with a `CUSTOM` event named
`blob.artifact` (or through the bot API); people publish by hand. Three kinds and a cap:
a *diff* is text drawn with colour by a forty-line classifier keyed on each line's first
character; a *markdown* document goes through the renderer messages use; an *html* page
is the exception this ADR exists for. It is shown in an `<iframe sandbox="allow-scripts">`
— no `allow-same-origin`, so it runs in an opaque origin with no cookies, no storage and no
way to call the workspace as the person — with a policy written into its own head
(`default-src 'none'`, inline style and script only, `connect-src 'none'`,
`form-action 'none'`) so it cannot phone home, and **only after a person clicks *Run
preview***. A page that runs when it arrives is a page that runs when somebody scrolls
past it. The outer page's CSP (`frame-src 'self'`, migration-free, `lib/security_headers.py`)
is what lets a `srcdoc` frame exist at all; that policy landed first, as a prerequisite.

## Alternatives considered
- **A `work` channel kind.** Every `kind IN (...)` on the server and client would grow a
  case, for a distinction one join answers.
- **Render agent HTML inline, or with `allow-same-origin`.** Inline is XSS by design; same
  origin gives the page the person's session. Neither is a rendering choice.
- **Run previews on arrival.** Convenient, and it turns every published page into code
  that executes because a channel was opened.
- **Artifacts as attachments.** Files are bytes behind a 302 to storage; artifacts are
  text the client draws. Sharing the table would make every viewer download and parse.

## Consequences
- `channels` gain no column; `work_id` is a LEFT JOIN in `CHANNEL_STATE_SELECT` and a
  nullable field on the wire. A client that ignores it sees a private channel.
- The `Fold` captures `blob.artifact` events (capped: ten per run, 200 KiB each); the run
  job persists them only when the channel is a work channel. Elsewhere they are inert.
- One new socket event, `work.updated`, carries status and artifact count; the client
  refetches. Both protocol twins changed together.
- Rate-limited as a send, audited as `work.started` / `work.artifact_published` /
  `work.finished`.
