---
type: decision
status: accepted
tags: [adr, import, slack, people, privacy]
links:
  [
    0002-uuidv7-primary-keys,
    0011-agui-is-an-inbound-transport,
    0034-a-guest-is-in-the-channels-they-were-invited-to,
    0038-an-export-takes-what-its-asker-may-take,
    0039-retention-removes-the-talk-and-a-hold-stops-it,
  ]
rules: []
---

# ADR 0042: A Slack export comes in as history, and its people wait for an invitation

## Context

A team moving from Slack asks one question before any other: does our history come with
us? The plan of 2026-10-18 (B4) named a Slack import and left its hard parts open. Three
were decided on 2026-10-22: who an imported person becomes, whether private conversations
come, and what happens to files.

What Slack hands an admin is a zip from its "Export data" page: `users.json`, one
reference file per kind of conversation (`channels.json`; and in an export of everything,
`groups.json` for private channels, `dms.json`, `mpims.json`), and a folder per
conversation holding a JSON array of messages for each day. It holds **no files** — a
message's file is a link back to `files.slack.com` that carries an access token in its
query (`?t=xoxe-…`), revocable from Slack's export page.

## Decision

**An admin uploads the zip, reads what is in it, chooses, and starts it. Slack's people
become placeholders that cannot sign in until an admin invites their address; private
channels and direct messages come only when the admin asks for them; files are copied
under a size cap, and a file that is not leaves a line saying so.**

- **Read before written.** The zip goes straight to object storage, never through the
  API. The worker opens it in place, checks it — the declared size of every member and how
  far it expands, before anything is decompressed — and reads only the reference files to
  answer a preview: how many conversations of each kind, how many days of history, who is
  matched to a member already and who would arrive as a placeholder, and which public
  channels already exist here (they merge into the existing one). Nothing is written until
  the admin starts it.
- **People are matched by address, else held as placeholders.** A Slack account whose
  address belongs to a member here is that member. Every other one becomes a
  **placeholder**: a deactivated `users` row marked `placeholder`, with Slack's name and
  address, no password and no handle. It cannot sign in, is sent no mail or push, is
  named by no mention and counted nowhere — every rule a deactivated account already obeys.
  **It becomes a person only through an invitation sent to that address**: accepting the
  invitation turns the placeholder into the account, keeping its history, channels and
  conversations, rather than making a second one. A join through a sign-on domain or an
  open link is refused for an address a placeholder holds, and an admin's Reactivate is
  refused for one; the answer to both is to invite it. Slack's apps and bots become
  placeholder bots — their messages keep their name — and are never claimable; an app
  becomes one only if a message of its turns up, since Slack lists most apps twice, as a
  user and as a bot, and one that never posted would be a name on nothing. A Slack
  account with no address in the export gets an undeliverable one under `.invalid` and
  stays a name on old messages; the People page says it came from Slack, and shows no
  address rather than the made-up one.
- **Public channels always; private ones only when asked.** Private channels, direct
  messages and group messages come only when the admin ticks the box, which starts
  unticked — they are their members' and nobody else's (ADR 0034's "public means public
  to members"). They come with their members, placeholders included, so that a claimed
  account finds its conversations where it left them. The admin who imports them is not
  added to them.
- **History, not news.** Imported rows are written, not sent: no notification, push,
  mail, badge, agent run, follow, unfurl, webhook or app delivery fires for a message
  that is years old. A conversation the import created is read up to its newest message
  for everybody in it; one it merged into keeps everybody's place, and its imported
  messages are older than that place. When it is done, members are told about the
  conversations that are new to them, as for any channel they are added to.
- **What comes.** Messages at their time and with their author, threads with their
  replies (and a reply sent to the channel too, as one), edits as edited — without the
  earlier text — reactions, pins, a channel's topic, purpose and archived state. Slack's
  markup becomes Blob's markdown: a person named becomes `@name` with their id kept beside
  the message; `@here`, `@channel` and `@everyone` stay words. **Not:** joins, leaves and
  renames, deleted messages, saved items, canvases, huddle notes, workflows, user groups and
  custom emoji images.
- **Ids are Slack's time.** A message's id is a UUIDv7 whose time is its `ts` — the
  microseconds ordering two messages within a millisecond — and whose remaining bits hash
  the conversation and `ts` (ADR 0002 stays true: ids sort as history happened). The same
  message gets the same id on every run, and a conversation the import creates gets the
  same id too, so an import that stops — a deploy restarts the worker — starts again where
  it stopped and skips what it already wrote.
- **Files are copied, within limits, and never by their token.** A file is fetched only
  from `https://files.slack.com/`, pinned to the address that was checked like every
  outbound request (ADR 0011), up to a size cap, and stored as Blob's own attachment on
  the message under Blob's upload rules. One not copied — too large, gone from Slack,
  hidden by Slack's plan, refused by those rules, or its link revoked — leaves a line in
  its message naming the file and why. The token in a link is never logged, stored or
  shown, and the zip — which holds every token — is deleted when the import ends. The
  finished page tells the admin to revoke the export's links on Slack's export page.
- **One at a time, in steps, in view.** A workspace runs one import at a time. The worker
  takes it in steps of a couple of minutes, each committing its rows together with how far
  it got, and queues the next; a step that died is picked up by a sweep. The admin page
  shows the progress and the first hundred problems; the audit log records who started
  it, with what choices, and how it ended.
- **Imported history is history.** A retention window shorter than its age removes it at
  the next sweep, and a legal hold stops that, as for everything else (ADR 0039).

## Consequences

- An admin can bring a whole Slack team's public history in an afternoon and invite its
  people afterwards; each invitation hands its person their past.
- A person who had a Slack account and is never invited stays a name on old messages,
  which is what a deactivated member already is.
- Two Slack accounts sharing an address — rare, and a Slack-side mistake — become one
  person here.
- The people list the app loads now puts who is here first and holds five thousand
  (it held a thousand, alphabetically, so an import could have pushed a current member off
  its end). A team that brings more than that shows the rest as "Someone" on their old
  messages.
- The importing admin holds the export, and with it every private conversation, before
  Blob does; the box decides only whether Blob carries them, never who reads them.

## Alternatives considered

- **Claiming a placeholder by signing up with its address** (Mattermost's import) —
  rejected: an invitation is an admin's act naming an address, and a private
  conversation's past should pass to a person only on one.
- **Matching people by name** — rejected: names collide, and an address is the identity
  Slack and Blob share.
- **Importing private conversations by default** — rejected: privacy is a feature, and
  the admin should choose it knowing what it carries.
- **Reading Slack through its API instead of the export** — rejected for now: it needs an
  app installed in the Slack workspace and runs into Slack's rate limits, while every plan
  can produce the export.
