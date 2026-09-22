# Micro-animations: the rest of the interface answers

**Status:** design, 2026-09-22; revised the same day after review (see the fix report at
the end). Asked for by Marko: *"lots of micro-animations in the interface."* The second
pass over the motion layer after [small motions](2026-09-16-small-motions-design.md).
Like that one it adds nothing to the vocabulary in `tokens.css`; unlike that one it lifts
two of its refusals — dialogs now leave, and a message that arrives live now arrives
rather than appearing.

## What changed since the last pass

The two refusals are lifted for different reasons, and only one of them is mechanism.

* **Dialogs.** They stayed enter-only because `{open && <X/>}` is what fires a dialog's
  focus trap, autofocus and on-mount request, and rendering them always would fire all
  of that at start-up. That was mechanism, and it has an answer: a wrapper that *mounts
  on open* and only *unmounts late* keeps every one of those firing exactly when it did.
  `DialogPresence` is that wrapper. As the exit begins it stops the dialog being modal
  without taking it off the screen (`letGo`: closed, and back in the top layer as a
  manual popover in the same task), so focus goes back to the opener at once and the
  page takes keys and clicks while the dialog fades over it; it unmounts when the exit
  ends. No frame is drawn outside the top layer, so none of this needs the `overlay`
  property that animating a native close would. Where a browser has no popovers the
  dialog simply stays modal through its exit.
* **Message arrival.** The last pass refused this first because it is Slack's rule —
  Slack does not animate a message arriving — and second because the list is
  virtualised. Animated arrival is therefore a **deliberate departure from Slack**, made
  because the owner asked for more motion, and kept small enough that it competes with
  nothing in anybody's fingers: 160ms, 4px, once, and never on history, scrolling or a
  channel switch. The virtualisation half is mechanism, and has an answer: key the
  entrance to *arriving* instead of mounting. The store marks an id when a message lands
  live in the conversation on screen (or when you send one), a row plays its entrance
  only while its id is marked, and the row settles the mark when the entrance ends.
  Every mark also expires after `FALLBACK_MS`, so a row that was not on screen to use
  one cannot find it waiting when it scrolls in later. The entrance is timed from the
  first row that draws it, not from the socket frame: in the browser check a render
  landed ~70ms after its frame, and an entrance timed from the frame was two-fifths over
  before it was seen.

The same mistake the second point avoids was already in the stylesheet: a reaction chip
popped and its count ticked on *mount*, which in a virtualised list means on every scroll
and every channel switch. Both now play only for a change that happens while the row is
on screen, which is what they were written for.

## The rules this stays inside

* **Tokens only.** Durations, easings, distances and scales come from `--dur-*`,
  `--ease-*` and `--motion-*`; every new keyframe moves only by a `--motion-*` value, so
  the reduced-motion policy (distance and scale to zero, fades keep their duration)
  covers it without a line of its own. No new tokens. The keyframes it adds are
  `arrive`, `row-arrive`, `focus-ring-in` and `fade-out`, and `backdrop-in` becomes
  `fade-in` now that it fades more than backdrops. The focus ring's resting place is a
  local knob on its rule, `--focus-ring-offset`, not a token.
* **Composite-only**, with one exception: the focus ring animates `outline-offset`,
  which moves a painted ring and never a box — outlines take no part in layout. Nothing
  here touches the message list's layout.
* **Nothing between an input and its first paint.** No transition on a channel switch or
  any other view switch, no delays, no view transitions. Keyboard highlights (the
  autocomplete, the emoji grid) move with the key and never fade. The conversation's
  empty state and the composer's send button were deliberately left still for this
  reason (below).
* **No new loops, nothing overshoots.** Every entrance travels one way and stops where it
  rests; nothing passes its resting place, so nothing shakes and nothing bounces.
* **Exits go through `usePresence`**, with `data-state="closed"` and `inert` on the
  leaving node.
* **Hands off** the top bar, the conversation header's actions, meetups, `MessageList`,
  `openChannel`'s unread code and the two consoles: other work is changing them.

## The changes

| Moment | Today | After |
|---|---|---|
| A dialog closes (Escape, backdrop, Cancel, done) | vanishes | `DialogPresence` holds it for `overlay-out` on the dialog and `fade-out` on its backdrop over `--dur-exit`, `inert`, then unmounts it. It stops being modal as the exit begins, so focus is back on the opener and the page is live straight away; it does not take focus back at the end. The Escape that closed it is default-prevented, so it closes that dialog and no other. Re-opening during an exit mounts a fresh one. The palette and the lightbox are not wrapped |
| Someone else's message lands in the conversation on screen — or yours, sent from another device or tab | appears | `arrive` — fade and rise `--motion-slide` over `--dur-open` — once, keyed to the store's mark |
| You send a message here | the pending row appears at 0.55 | the pending row plays `arrive`. When the server's copy replaces it mid-entrance, the new row picks the entrance up where the pending one had got to (a negative `animation-delay`, from when that row began) instead of snapping or starting again; after the entrance has ended, it simply replaces it. The socket's copy of it adds nothing: the store remembers the `clientMsgId`s this tab sent |
| A link preview, or a file, arrives after its message | appears | `arrive`, but only under a row that was already drawn without it; a row that mounts with it (scrolling, switching) is still |
| A reaction chip or count, on a row that mounts | pops and ticks on every mount | pops and ticks only for a change made while the row is on screen |
| Reply count under a message; the thread panel's reply count; a reaction count going down | digit swaps | `count-tick` on any change since the count mounted, up or down (`components/Count.tsx`); the thread panel's count is keyed by its thread, so opening another one does not tick |
| A button is pressed | icon buttons, rows and menu items give; `.btn` only darkens | `.btn`, `.chip`, the send button, reaction chips, reply links, switches, the sidebar's add buttons and the small dismiss buttons give to `--motion-press` via `scale`, which composes with any transform the element already has; the existing icon-button press eases instead of snapping |
| Hovering one of ~20 controls with no transition | colour snaps | `--dur-fast` colour transition. An emoji cell's pointer highlight fades in and out; its keyboard cursor is painted on a layer nothing transitions, so it never fades, on or off |
| A switch is flipped | knob slides on `--ease-standard` | knob slides on `--ease-out`; the switch gives while pressed |
| Save for later, Follow — turned on | colour changes | `badge-pop` on the icon or the button |
| A conversation is joined, created or opened into the sidebar | appears | its row slides in from `--motion-slide` to the left, once, and only if it arrived while the sidebar was on screen |
| An image loads — avatars, attachments, the files grid, app image blocks | pops in when decoded | fades in over `--dur-open`; anything already cached is shown at once; an avatar keeps its initials underneath until the photo has loaded, and keeps them if it never does |
| Someone starts or stops typing | the line cuts in and out | enters with `arrive`, leaves through `usePresence` holding its last sentence |
| "Link copied" | appears and vanishes | `chip-in`, and out through `usePresence` (`components/Confirmation.tsx`) |
| A control takes keyboard focus | the ring appears | the ring settles in from `--motion-slide` further out than where it rests, as it fades in |
| A text field takes focus | its border snaps to the accent | the border colour transitions |
| A submit is refused — sign-in, creating a channel, sending feedback, a channel detail that did not save | the error line appears | it settles in with `arrive`, keyed to `data-refused`, which only the submit handlers set. A line that reports a state — Catch up with no model configured, a list that did not load — only fades in |
| An empty state or the sign-in card appears | cut | `arrive`, on the view the app opened onto only, before anything on it is touched (`lib/firstView.ts`). After the first pushed route, Back, press or key, every empty state was switched to — another view, or a tab, filter or toggle inside one — and simply appears. A conversation's, a search's and the channel browser's never move, because they flip as you switch or type |
| The phone sidebar opens | the drawer slides; its scrim cuts in | the scrim fades in with it |
| The connection banner, a slash command's private reply | cut in | `arrive` |

## Skipped, and why

* **The consoles.** `/admin` and `/settings` are being redesigned in parallel, so none of
  their own code changed: no fade between sections, no crossfading Save → Saved, and
  their confirmations and the agent install dialog keep the plain `{open && <X/>}` mount
  — one `DialogPresence` line each, once that work has landed. The shared rules do reach
  them, which is intended: `.btn`, `.chip`, `.toggle` and `.input` motion, the error
  line's fade (and settle, where a console form sets `data-refused`), the connection
  banner, an empty state on the view the app opened onto, and the focus ring.
* **Collapsible sidebar sections.** The sections are not collapsible. Adding that is a
  feature — state, persistence, a keyboard story — not a motion.
* **Custom checkboxes and radios.** There are none; the few checkboxes are native, and a
  native check cannot be animated without replacing the control.
* **Floating jump buttons.** The only one is the unread jump bar, which already leaves
  through `usePresence` — and lives in `MessageList`, which is hands-off.
* **The member count in the conversation header, the top bar's counters.** Hands-off.
* **The lightbox's exit.** Kept enter-only as asked. It is a native `<dialog>` like every
  other one here, and `letGo` would give it the same exit with one wrapper line — the
  `overlay` property is not what stands in the way.
* **Pin and star pops.** Both toggles live in menus that close on the click, so there is
  nothing left on screen to pop.
* **The send button arming.** A pop when the first character makes it ready would also
  play whenever the composer mounts with a draft — which is every channel switch.
* **The thread tools disclosure.** Animating its height would resize the thread's
  virtualised list for 160ms.
* **A channel's menu** still vanishes when a choice is made: `ChannelMenu` is mounted by
  its parent — the conversation header, or a sidebar row — which drops it with the
  click, so its `Menu` never sees a close to animate. Its **Leave and Archive
  confirmations cut on confirm** for the same reason: `onConfirm` closes the menu, and
  the menu takes its `DialogPresence` with it. Cancel still animates out.

## Known costs

* **Three dialog presences per message row.** `MessageRow` holds `DialogPresence` for
  start-work, forward and delete — a `usePresence` hook and two pieces of state each, in
  every row the virtualiser renders, for dialogs almost never open. Hoisting them into one
  store-held presence beside the list (the shape the lightbox already has) would cost one
  of each for the whole conversation. Left for later.
* **Where there are no popovers**, a leaving dialog stays modal for its 150ms exit: the
  page is inert and focus sits on `<body>` until it unmounts, so a key or click in that
  window is lost. Every browser Blob supports today has popovers; this is the fallback,
  not the path.
* **A double-click's second click lands on the page.** The page is live the moment a
  dialog starts to leave, so the second click of a double-click on a dialog's button —
  or on its backdrop — reaches whatever is under it during the 150ms exit. That is the
  "page is live" behaviour working as intended, and accepted: the review found nothing
  destructive a stray second click could reach there, and a page that swallowed it
  would be the modal-through-the-exit behaviour this replaced.
* **Checked in Chromium only.** `letGo` — closing a modal dialog and showing it again as
  a popover in the same task — and the focus return behind it were verified in Chromium,
  the only browser installed here. Safari 17+ and Firefox 125+ both have the popover API,
  but the exit and the focus return still need a manual check in each before this ships.

## Verification

* Unit: `DialogPresence` mounts only on open, holds the dialog `data-state="closed"` and
  `inert` until its own `animationend`, stops answering Escape while it leaves, keeps
  the value it was opened with, and mounts a fresh dialog when reopened mid-exit. With
  popovers it closes the dialog and shows it as a popover as the exit begins, focus is
  already on the opener, and the unmount does not pull focus back from where the person
  moved it; without them it stays modal and hands focus back on unmount. An Escape the
  stack answers is default-prevented, and one it does not answer is left alone. The store marks
  a live arrival once, never this tab's own echo or a page of history, marks your own
  message from another device, moves an own send's mark from the pending row to the
  server's copy, and expires every mark. A row settles its mark on `animationend` and a
  remount does not replay; a late preview, a new chip and a changed count are marked and
  a mounted-with one is not. A count ticks down as well as up, and the thread panel's
  does not tick on a thread switch. An empty state arrives on the first view and not
  after a pushed route, a press or a key; an empty Later tab switched to does not
  arrive. The typing line and the confirmations hold through their exits;
  a sidebar row that arrives slides in and one that was there does not; an avatar keeps
  its initials until its photo loads.
* In a browser: 1440px and 400px, and `prefers-reduced-motion: reduce` emulated — no
  translate or scale anywhere, the fades still present. Open and close a dialog, send a
  message, react, flip a switch.

## Fix report — review round 1

What the review found, and what changed.

1. **The shake was a bounce.** `error-in` went −slide → +slide → home, crossing its
   resting place, and it was keyed to every `.error-text` in a `.dialog` — so Catch up's
   "No model is configured" line, which both production servers show on every opening,
   shook at the reader each time. `error-in` is gone. A refused submit now settles in
   with `arrive` (one way, 4 → 0px, never past home), keyed to `data-refused`, which only
   submit handlers set: the sign-in form (not a lapsed invitation), creating a channel,
   sending feedback, and the three channel-detail actions (not the member list failing to
   load). Checked in Chromium: the sign-in refusal's x stays 0 and y runs 4 → 0; Catch
   up's line has no `data-refused` and only fades.
2. **`Count` compared against the first value drawn**, so 3 → 4 ticked but 4 → 3 did
   not, and the unkeyed thread panel ticked on a switch between two loaded threads. It
   now tracks "changed since mount" in a render-phase state pair, and the panel's count
   is keyed by `rootId`. Tests: a return to an earlier value ticks, a thread switch does
   not; both fail when either fix is undone. Checked in Chromium: Ana's reaction added
   (1 → 2) and taken back (2 → 1) both tick.
3. **The emoji cell's ring travelled under reduced motion**, because the keyframe
   hard-coded a 2px rest and the cell rests at −2px. `:focus-visible` and `focus-ring-in`
   now share `--focus-ring-offset`, which the cell sets to −2px. Checked in Chromium: the
   cell's ring starts and rests at −2px under reduced motion, and runs 2 → −2px without.
4. **Focus waited for the exit.** Fixed rather than documented: `letGo` closes the
   dialog as its exit begins and puts it straight back in the top layer as a manual
   popover in the same task, the popover attribute holding it `display: block` for the
   instant in between. Checked in Chromium at 1440px and 400px: the box is identical
   before and after the swap (at 400px it differs only by the exit's own first-frame
   scale), `:modal` is false and `:popover-open` true, focus is on the opener one frame
   after Escape, a point over the sidebar hit-tests to the sidebar, a real mouse click on
   a channel mid-exit lands and navigates, and each exit animation starts once and is
   never cancelled. Feature-detected; without popovers the old behaviour remains, and
   that trade-off is written down in CLAUDE.md and above.
5. **Minor.** `.work-tabs .chip` transitions `scale`. The autocomplete and the emoji grid's
   keyboard highlights no longer fade (the emoji cell fades only under the pointer, and
   only when it is not the keyboard's cell). `.chip.palette-scope` has no press, no
   transition and no ring entrance. This note now says which shared rules reach the
   consoles, records animated arrival as a departure from Slack, and records the
   ChannelMenu confirm cut and the per-row presences. Empty states arrive on the first
   view only: `lib/firstView.ts` flips on the first pushed route or Back, and
   conversations and search are exempt even before that — search picked out by its head,
   because Saved, Activity, Threads and Tasks reuse `.search-results`, which the first
   browser run caught. Your own message sent from another client now arrives with an
   entrance: the store remembers the `clientMsgId`s this tab sent (the last 256) instead
   of treating every message you authored as an echo.

## Fix report — review round 2

1. **One Escape closed two stacked dialogs and lost the lower one's draft.** `useEscape`
   stopped the key's propagation but not its default, and the default is the browser's
   own close request, which runs after every handler and goes to whichever dialog is
   modal *by then*. Once `letGo` had taken the top dialog out of modality, that was the
   one underneath: Help (⌘/) over Feedback, then Escape, closed both and threw the draft
   away. The same default was behind an older variant on the base tree — ⌘K inside any
   dialog, then Escape, closed both. `useEscape` now calls `preventDefault()` on every
   Escape it answers, and leaves alone any it does not. Why is written beside `letGo` and
   in CLAUDE.md's design-layer paragraph. Tested by the flag the browser reads, since
   happy-dom has no close requests: the answered event is `defaultPrevented`, an
   unanswered one is not, and the test fails with the line removed. Checked in Chromium
   with the reviewer's harness, rebuilt against this tree in a copy of its own: Help over
   Feedback, Escape — Help closes, Feedback stays open with its draft and focus back in
   it; Escape again — Feedback closes and focus is back on its button; ⌘K over Feedback,
   Escape — only the palette closes. The harness's round-1 bundle still loses both.
2. **Empty-state entrances replayed inside the first view**, on a Later tab or a Browse
   filter, until the first route change. Rather than find every in-view control one by
   one — Tasks' scope, the Files kinds, the Activity filters and Help's query do the same
   thing — `lib/firstView.ts` now also ends the first view on the first press or key on
   the page, captured on `window` once. `.browse-body` is exempt the way search is, so
   its filter and "Include archived" never animate even on first load. Tests: a press and
   a key each leave the first view and the router's own popstate does not, and on the
   Later list a switch from a tab with a message to an empty one mounts an empty state
   that does not arrive; both fail with the press listener removed. One consequence,
   intended: signing in is typing, so the view the app opens onto just after signing in
   does not animate its empty state; a reload onto one does.
3. **A double-click's second click lands on the page** during the exit. Accepted, and
   written down under Known costs.
4. **The emoji cell's pointer highlight snapped out.** It now fades in and out. The
   keyboard cursor had been painted on the same `background-color`, and a transition
   cannot tell which of the two changed it, so it moves to a `background-image` layer
   that nothing transitions. Checked in Chromium: hover in and out each start a
   `background-color` fade; the cursor arriving on or leaving a cell, hovered or not,
   starts none.

Only Chromium is installed here: the exit and the focus return still need a manual check
in Safari 17+ and Firefox 125+ (see Known costs).
