---
type: decision
status: accepted
tags: [adr, notifications, mail, privacy]
links:
  [
    0034-a-guest-is-in-the-channels-they-were-invited-to,
    0031-a-persons-sign-in-is-the-addresss,
  ]
rules: []
---

# ADR 0036: Blob emails you only about what waited for you, and only while you were away

## Context

The only mail Blob sent was invitations and password resets. Somebody who closed the tab
heard nothing until they came back, unless they had push on that device. Slack's answer is
the habit people expect: when you are not active, mentions and direct messages are bundled
into an email, once every 15 minutes by default, or once an hour. Notification fatigue is
the complaint every incumbent gets (`services/notify.py`'s first line), and the inbox is
the least welcome place to be interrupted, so the open question was how little to send.

## Decision

**What was addressed to you — a DM, a mention of you or of a group you are in, a reply in
a thread you follow — waits while you have no Blob open; whatever is still unread when your
window has passed goes in one email.**

- **Away means no Blob open.** Presence `active` is a live socket on any device; somebody
  with a tab open is told by Blob (push already covers a background tab), and `/away`
  counts as away. A message is held only for whoever was not active when the notify job
  saw it, and somebody who comes back before their window ends has their queue dropped
  rather than mailed: the app shows them what is unread.
- **Only what was addressed to you.** `notify.decide`'s other reasons — `@channel`,
  keywords, every message in a busy channel — never reach the inbox. Agents, deactivated
  accounts and anybody who chose Never are not held at all.
- **Still unread, still yours.** At sending time each item is checked again: not deleted,
  the person still a member of its room (a private channel they left says nothing more),
  and unread — the channel cursor for a message, the thread cursor for a reply, and for a
  mention or DM inside a thread they do not follow, the channel's badge cleared since it
  arrived (reading such a thread records nothing).
- **One email per window.** `notification_mail` (migration 0067) is the queue; a minute cron
  sends to whoever's oldest item has waited 15 minutes or an hour (`prefs.emailWhenAway`,
  default `quarter_hour` as in Slack), then forgets what it considered. Quiet hours and a
  pause hold the queue; nothing waits more than a day. A mail server that refuses one email
  pauses the job for a quarter of an hour, so a server with no working SMTP logs one line
  per quarter hour, not one per person per minute.
- **Stopping them needs no sign-in.** Every email carries RFC 8058's one-click
  `List-Unsubscribe` (+ `-Post`) and a link to `/unsubscribe?t=…`: an HMAC token under a key
  derived for this purpose alone, naming one account, able only to turn its away emails
  off, and never expiring. The page asks before it stops anything, because mail scanners
  follow links. Every message Blob sends now carries its own `Date` and `Message-ID`, and
  away emails `Auto-Submitted: auto-generated`.

## Consequences

- Message text leaves the workspace in an email, as Slack's does: the preview of what was
  addressed to that person, in rooms they are in, to the address on their account.
- Existing accounts start at every 15 minutes, which is Slack's default; a release that
  ships this says so in What's new.
- Not built: a daily or weekly digest of channels you missed, HTML mail, and a workspace
  setting that keeps message text out of email.
