# Small motions: the moments that still snap

**Status:** design, 2026-09-16. Asked for by Marko: *"improve micro-animation of the front
end so that it feels very good for using."* Bounded: the motion layer exists and this
adds nothing to its vocabulary.

## What "feels very good" is made of

Three things, in the order they matter:

1. **Nothing waits.** An action the person took is on screen before the server answers.
   Sending already is (the outbox); saving is (`toggleSaved`); **reacting is not** —
   `store.toggleReaction` awaits the request and the chip appears when the socket frame
   comes back. On a slow link that is the one deliberate thing a person does to a
   message, answered a beat late. This is the largest single change in the slice and it
   is not an animation at all.
2. **Nothing jumps.** A layout that shifts under the pointer reads as broken however
   pretty the transitions are: the message list gains a scrollbar and the whole column
   moves 15px; the composer grows a line late because JavaScript measured it after the
   paint.
3. **Small things answer.** A reaction pops (shipped 2026-09-14); a press gives; a menu
   fades in and out. But a toast, the thread panel and the unread bar vanish with no exit,
   a badge changes its number with no tell, the lightbox opens with a cut, an attachment
   chip appears from nowhere, a finished run flattens in one frame. Each is a 120–160 ms
   answer the vocabulary already has words for.

## The rules this stays inside

* **Meadow's motion budget** (`tokens.css`, `b1aed985`): entrances and hovers 120–160 ms
  `--ease-out`; exits shorter (`--dur-exit`); the only loops are the 1.4 s shimmer and the
  1.6 s pulse; nothing bounces. Every new keyframe uses the existing tokens.
* **Reduced motion is a token policy:** distances (`--motion-slide*`) and scale
  (`--motion-scale-in`, `--motion-press`) go to zero and fades keep their duration. New
  motion reads only those tokens, so the policy covers it without knowing it exists.
* **High-frequency actions are never delayed** (Track U): send, switch channel, type.
  Nothing here sits between an input and its first paint; every transition is on
  `opacity` and `transform` except where noted, so it costs a composite and never a
  layout.
* **Overlays enter; only menus leave** — extended, deliberately, to *notices and panels*:
  a toast and the thread panel are held through a 150 ms exit by `usePresence`, the same
  hook `Menu` uses. Dialogs keep `{open && <X/>}` for the reasons CLAUDE.md gives (focus
  trap, autofocus, a request on mount).
* The 44 colour names, the elevation ring rule, and the ratchets are untouched.

## The changes

### 1. Reactions are optimistic

`toggleReaction` applies the change to the store first — the caller's id added to or
removed from the emoji's `userIds`, a new chip appended when none exists, an empty chip
removed — then calls the API; on failure it reverts and rethrows so the existing error
toast still fires. The socket's `reaction.added`/`reaction.removed` frame then arrives
for a state that already holds it: `applyEvent`'s reaction reducer must be idempotent
(adding a present id is a no-op; removing an absent one is a no-op). The `reaction-pop`
keyframe now plays at click time, which is what it was written for.

### 2. Nothing jumps

* `.message-list` gains `scrollbar-gutter: stable` and `overscroll-behavior: contain`.
* The composer's `<textarea>` gains `field-sizing: content` (Baseline 2026-06); the
  JavaScript autosize stays as the fallback, skipped when
  `CSS.supports('field-sizing', 'content')`, and is deleted one release later.

### 3. Small things answer

| Moment | Today | After |
|---|---|---|
| Toast dismissed or expired | vanishes | held by `usePresence`, `data-state="closed"` → `overlay-out` over `--dur-exit`; enter becomes fade + rise `--motion-slide-lg` over `--dur-open` |
| Thread panel closed | vanishes | `panel-slide-out` over `--dur-exit`, held by `usePresence` (`ThreadPanelSlot`, mounted from `Workspace.tsx`) — inside the conversation only; leaving the conversation with a thread open drops the panel with the column, because a panel outliving its column would reflow the incoming view |
| Unread jump bar, catch-up strip appear/leave | cut | enter `overlay-in`; leave held for `overlay-out` |
| A badge's number changes | new digit | the badge re-mounts on `key={count}` and plays `badge-pop` (scale from `--motion-scale-in`, `--dur-fast`); same for the top bar's counters |
| A reaction's count changes | new digit | the count span re-mounts on its value, whoever changed it, and plays `count-tick` (rise `--motion-slide`, `--dur-fast`, no opacity ramp). A key cannot tell whose click it was, and reactions apply optimistically, so "somebody else" is not a distinction the mechanism can make; the chip's own `reaction-pop` covers a *new* chip fading in, and a second ramp on the digit inside it read as a double fade |
| Attachment chip added | appears | `chip-in` (scale from `--motion-scale-in` + fade, `--dur-fast`); `data-status` changes transition opacity |
| Run card finishes | flattens in a frame | `border-color`, `box-shadow`, `opacity` transition over `--dur-open` |
| Work tab selected | snaps | background and colour transition over `--dur-fast` (the token every other row already uses) |
| Pending message confirmed | opacity snaps | `.message[data-pending]` transitions opacity over `--dur-fast` |
| Lightbox opens | cut | `.lightbox` plays `overlay-in`, `::backdrop` plays `backdrop-in` (enter only — a native `<dialog>` keeps its close) |

Nothing else moves. In particular: rows arriving in the message list do not animate
(Slack's rule, and the list is virtualised — an entrance on every mount would play on
every scroll), channel switches do not crossfade, and the sidebar's active row keeps its
existing 120 ms colour transition.

## Verification

* Unit: `store.reactions.test.ts` — the chip is in the store before the request resolves,
  a failure reverts it, the socket frame after an optimistic add changes nothing;
  `Toasts.test.tsx` and `ThreadPanel.test.tsx` — a closed one stays mounted with
  `data-state="closed"` until `animationend`; `Composer` — the JS autosize is skipped when
  `field-sizing` is supported.
* In a browser: the 400 px and 1440 px sweeps; Lighthouse in snapshot mode with a menu
  open; DevTools with `prefers-reduced-motion: reduce` emulated — no translate or scale
  anywhere, fades still present; a DevTools performance trace of ten sends and ten
  reactions on a long channel, checking for long animation frames from anything added.

## Not in this

View transitions, anchor positioning, scroll-driven animations (not cross-browser);
animated message arrival; a dialog exit (the `{open && <X/>}` rule stands); any new
easing or duration token.
