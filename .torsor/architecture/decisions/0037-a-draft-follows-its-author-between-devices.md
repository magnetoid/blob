---
type: decision
status: accepted
tags: [adr, messages, drafts, privacy, realtime]
links:
  [
    0004-persist-then-broadcast,
    0036-blob-emails-you-only-about-what-waited-for-you,
  ]
rules: []
---

# ADR 0037: A draft follows its author between devices, and nobody else

## Context

Drafts lived only in the browser they were typed in. `lib/drafts.ts` said why, and when
that would stop being right: syncing means a write path for text the author has not
decided to share, "but when drafts become a list you can open — Slack's 'Drafts & sent' —
that calculus changes, because a list you cannot reach from your laptop is not a list."
The plan (M3 · B3) makes them that list. The hard part is not storing them; it is that the
composer is drawn from the draft map, so a copy arriving from another device could replace
the words under somebody's fingers.

## Decision

**A draft is saved to the server a pause after typing stops, readable only by its author,
told to the author's other tabs, and never allowed to overwrite what a tab is typing.**

- **Stored, and only the author's.** `drafts` (migration 0068) is keyed on (person, place),
  where a place is the client's own key — the channel, or `channel:root` for a reply. Only
  where the author could send: a member of a room that takes messages. `GET /api/drafts`
  lists theirs in rooms they are still in; nothing else reads the table, and the only
  broadcast is `draft.updated` to the author's own sockets.
- **The tab typing wins.** An entry this tab typed and the server has not confirmed is
  `unsynced`; `draft.updated` never replaces one, and a tab ignores the echo of its own save
  (`device`). On arrival the tab merges: what it never got confirmed wins and is sent again,
  otherwise the server's list is the truth.
- **Sending clears it everywhere — on the live path only.** The send route deletes the
  author's draft for that place and tells their tabs. `messages.announce` does not: a
  scheduled send runs it too, and must not wipe a sentence typed since it was scheduled. A
  clear typed offline stays as an empty unsynced entry until the server hears it, so a
  message sent offline cannot bring its draft back.
- **Bounded.** Two hundred per person, the newest kept; thirty days untouched and it goes;
  `draft` rate-limited at 120 a minute, the client saving at most one request per place at
  a time, 700 ms after the last keystroke, and in a `keepalive` request as the tab closes.

## Consequences

- Unsent text now sits on the server. It is the author's own, in rooms they are in, and
  goes on send, on emptying, or after a month — the trade the old note named and the list
  makes worth it.
- The Drafts view is drawn from the same map the composer writes, so it is current without
  a fetch; it appears in the sidebar only while something is unsent.
- Not built: "Sent" beside Drafts, and a draft on one device appearing live in a composer
  open on another while its owner is idle there is limited to what `applyRemote` allows.
