# Small motions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client feel immediate: reactions land before the server answers, nothing jumps, and the moments that still snap (toasts, panels, badges, chips, the lightbox, a finished run) answer inside Meadow's motion budget.

**Architecture:** One store change (optimistic reactions with rollback), two layout-stability CSS rules, and a set of small entrances and exits built only from the existing tokens (`--dur-*`, `--ease-*`, `--motion-*`) and the existing `usePresence` hook, so the reduced-motion policy covers them unchanged.

**Tech Stack:** React 19, zustand, vitest (happy-dom), CSS in `apps/web/src/styles/app.css`, tokens in `tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-16-small-motions-design.md` — binding.

## Global Constraints

- Branch `small-motions` in the main checkout. Commit per task. Do not push.
- The gate at every commit, from the repo root: `pnpm check` (tsc, eslint, vitest, and the backend suite — a client-only change still runs it) and `torsor guard --strict --severity error $(git ls-files '*.py')`. `pnpm exec vitest run` from `apps/web` for the fast loop.
- New motion reads only existing tokens: durations `--dur-fast`/`--dur-open`/`--dur-exit`, easings `--ease-out`/`--ease-in`/`--ease-standard`/`--ease-color`, distances `--motion-slide`/`--motion-slide-lg`, scales `--motion-scale-in`/`--motion-press`. No new token, no literal `ms` in `app.css`, no `cubic-bezier` outside `tokens.css`.
- Transitions and keyframes animate `opacity` and `transform` only, except the run card's `border-color`/`box-shadow` and the tab's `background`/`color`, which the stylesheet already transitions elsewhere.
- Every `@keyframes` added goes beside the existing ones (`app.css` ~4890–4960) with a one-line comment saying what plays it.
- Elevation carries its own border: an elevated surface sets `box-shadow` and no `border`. The 44 colour token names are not touched.
- Exits are held with `lib/usePresence.ts` (`{present, state}`), never with a timer of the component's own.
- Tests: `// @vitest-environment happy-dom`, `fireEvent`, roles; no `user-event`. happy-dom fires no `animationend`, so presence tests assert the closed node is present with `data-state="closed"` right after the close and use the hook's fallback timer with fake timers to see it go.
- `.torsor/map` timestamp churn: `git checkout -- .torsor/map` before staging.

---

### Task 1: Reactions are optimistic

**Files:**
- Modify: `apps/web/src/lib/store.ts` (`toggleReaction`, ~line 989; the reaction branch of `applyEvent`)
- Create: `apps/web/src/lib/store.reactions.test.ts`

**Interfaces:**
- Produces: `toggleReaction(message, emoji)` mutates the store before awaiting; `applyEvent` reaction handling idempotent.

- [ ] **Step 1: Read the reducer.** In `store.ts`, find how `applyEvent` folds `reaction.added` / `reaction.removed` (grep `reaction.added`). Note the `Reaction` shape (`{emoji, userIds}` from `@blob/shared`).

- [ ] **Step 2: Failing tests.** Model on `store.identity.test.ts` for how the store is set up with a `currentUser` and a message in a channel. Cases: after `toggleReaction` is *called* (not awaited) the message in the store shows the user's id under the emoji; when the API rejects, the store no longer shows it and the promise rejects; a `reaction.added` frame arriving after the optimistic add leaves exactly one id; `toggleReaction` on an emoji the user already reacted with removes the id immediately and removes an emptied chip. Mock `api.messages.react/unreact` with a deferred promise (`let resolve; new Promise(r => resolve = r)`).

- [ ] **Step 3: Implement.** Extract the in-place reaction edit into a pure helper `withReaction(message, emoji, userId, present: boolean): Message` beside the other pure helpers in `store.ts`; use it from `toggleReaction` (apply, then `try { await api } catch { apply the inverse; throw }`) and from the reducer's two cases so idempotency is one function's property. Update the `toggleSaved` docstring's clause "unlike a reaction it has to be" — now both are.

- [ ] **Step 4: Run, gate, commit.** `pnpm exec vitest run src/lib/store.reactions.test.ts src/lib/store.unread.window.test.ts src/features/messages/MessageRow.reactions.test.tsx`. Commit: `feat: react before the server answers`.

---

### Task 2: Nothing jumps

**Files:**
- Modify: `apps/web/src/styles/app.css` (`.message-list` ~line 1168), `apps/web/src/features/messages/Composer.tsx` (the autosize effect ~lines 133–139)
- Test: `apps/web/src/features/messages/Composer.format.test.tsx` (or the nearest Composer test) — one case

- [ ] **Step 1:** In `.message-list` add `scrollbar-gutter: stable;` and `overscroll-behavior: contain;` with a two-line comment (the 15 px column shift when a channel first becomes scrollable; the bounce that scrolls the page behind the list on trackpads).
- [ ] **Step 2:** On the composer `<textarea>` add the class rule `field-sizing: content;` and in the effect: `if (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')) return;` before measuring, with a comment that the JavaScript is the fallback and is deleted one release after this ships. Test: with `CSS.supports` stubbed true the effect leaves `style.height` untouched; stubbed false it sets it.
- [ ] **Step 3:** Gate, commit: `fix: stop the list and the composer from jumping`.

---

### Task 3: Toasts leave, and arrive from below

**Files:**
- Modify: `apps/web/src/components/Toasts.tsx`, `apps/web/src/styles/app.css` (`.toast` ~line 4953 and ~5585)
- Modify: `apps/web/src/components/Toasts.test.tsx`

- [ ] **Step 1: Failing test.** After `dismiss(id)` (drive the `useToasts` store directly), the toast element is still in the document with `data-state="closed"`; after the presence fallback (fake timers, 400 ms) it is gone.
- [ ] **Step 2:** Split a `ToastItem({toast, onDismiss})` component out of the map: `const ref = useRef<HTMLDivElement>(null); const {present, state} = usePresence(open, ref)` where `open` is whether the toast is still in the store — so the parent renders `ToastItem` for ids it has seen until they finish leaving. Simplest: keep a `leaving` list in the parent: ids removed from the store stay in a local `useState` list until the item reports `present === false` (callback prop). Read `Menu.tsx` for the exact way `usePresence` is wired there and copy that shape.
- [ ] **Step 3: CSS.** `.toast` enters with `toast-in` (opacity 0→1, `translateY(var(--motion-slide-lg))` → 0, `--dur-open --ease-out`); `.toast[data-state="closed"]` plays `overlay-out` over `--dur-exit --ease-in` `forwards`. Add `toast-in` beside the other keyframes with its comment.
- [ ] **Step 4:** Gate, commit: `feat: toasts arrive and leave instead of appearing and vanishing`.

---

### Task 4: Panels leave

**Files:**
- Modify: `apps/web/src/app/Workspace.tsx` (where `ThreadPanel` is mounted), `apps/web/src/features/messages/ThreadPanel.tsx` (root element gets `ref` and `data-state`), `app.css` (the panel rule that plays `panel-slide-in`; add `panel-slide-out`)
- Modify: the unread jump bar and the catch-up strip the same way if they are mounted conditionally (`grep -n "unread-jump-bar\|CatchUpStrip" apps/web/src/features/messages/*.tsx`)
- Test: `apps/web/src/features/messages/ThreadPanel.test.tsx` — closing keeps the panel mounted with `data-state="closed"`; `CatchUpStrip.test.tsx` — same for the strip.

- [ ] **Step 1:** Failing tests as above.
- [ ] **Step 2:** In `Workspace.tsx`, hold the thread panel with `usePresence(Boolean(threadRootId), ref)` and render it while `present`, passing `state` down as `data-state`; **the panel must keep the last non-null `threadRootId` while it exits** (store it in a ref updated when non-null), or it renders empty for 150 ms. `.thread-panel-root[data-state="closed"]` (use the panel's actual root class) plays `panel-slide-out` (`translateX(0)` → `translateX(var(--motion-slide-lg))` + fade, `--dur-exit --ease-in forwards`). Same pattern for the strip and the jump bar with `overlay-out`.
- [ ] **Step 3:** Gate, commit: `feat: the thread panel and the notices leave the way they came`.

---

### Task 5: Badges and counts announce a change

**Files:**
- Modify: `app.css` (`.badge` ~line 938; `.reaction` count span; new keyframes `badge-pop`, `count-tick`), the components that render `.badge` (`grep -rn 'className="badge' apps/web/src`), `MessageRow.tsx` (~line 473–490, the reaction count)
- Test: `MessageRow.reactions.test.tsx` — the count element's `key` changes with the count (assert the DOM node is replaced: hold a reference, re-render with a new count, expect a different node)

- [ ] **Step 1:** Wrap each `.badge`'s count in `key={count}` so a change re-mounts it; `.badge { animation: badge-pop var(--dur-fast) var(--ease-out); }` with `badge-pop` from `scale(var(--motion-scale-in))` + opacity 0.6 to `scale(1)` + 1. Under reduced motion the scale token is 1, so only the fade remains — the policy, not a media query here.
- [ ] **Step 2:** The reaction chip's count: `<span key={count} className="reaction-count">` with `count-tick` (`translateY(var(--motion-slide))` → 0, opacity 0→1, `--dur-fast --ease-out`). The chip itself keeps `reaction-pop` keyed by emoji.
- [ ] **Step 3:** Gate, commit: `feat: a number that changes says so`.

---

### Task 6: Chips, cards and tabs settle

**Files:**
- Modify: `app.css` — `.attachment-chip` (~1952; add `chip-in`), `.attachment-chip[data-status]` (transition opacity), `.agent-run-card` (~6120; transition `border-color`, `box-shadow`, `opacity` over `--dur-open --ease-standard`), `.work-tabs` buttons (~7140; transition `background`, `color` over `--dur-fast --ease-color`), `.message[data-pending="true"]` (~1281; transition `opacity --dur-fast --ease-color` on the base `.message` rule so both directions animate)
- No component change; `AttachmentTray.tsx` already keys chips by `item.key`.

- [ ] **Step 1:** Add each rule with a one-line comment saying which moment it answers. `chip-in` beside the keyframes.
- [ ] **Step 2:** Check in a browser that a chip added while another is uploading does not restart the other's animation (keys are stable — it should not).
- [ ] **Step 3:** Gate, commit: `feat: chips, run cards and tabs settle instead of switching`.

---

### Task 7: The lightbox enters

**Files:**
- Modify: `app.css` (`dialog.lightbox-host` ~1643, `.lightbox` ~1652, `::backdrop` ~1648)

- [ ] **Step 1:** `dialog.lightbox-host[open] .lightbox { animation: overlay-in var(--dur-modal) var(--ease-out); }` and `dialog.lightbox-host[open]::backdrop { animation: backdrop-in var(--dur-modal) var(--ease-out); }`. Enter only; the native dialog's close stays a cut, consistent with the dialogs.
- [ ] **Step 2:** Gate, commit: `feat: the lightbox fades up`.

---

### Task 8: Verify in a browser

- [ ] Sign in to the dev workspace; react to a message on a throttled connection (DevTools "Slow 3G") — the chip appears at click, and a forced failure (stop the API) reverts it with the toast.
- [ ] Emulate `prefers-reduced-motion: reduce`: no translate or scale on any of the new moments, fades still visible.
- [ ] The 400 px and 1440 px sweeps; Lighthouse snapshot with a menu open.
- [ ] A performance trace of ten sends and ten reactions in a long channel; note any long animation frame from the new rules in `.torsor/active/context.md` if one appears (none expected — every new rule is compositor-only).
- [ ] Write what was seen into the final report; no commit unless something needed fixing.
