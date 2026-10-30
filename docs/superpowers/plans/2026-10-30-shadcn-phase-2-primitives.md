# shadcn Phase 2 — Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blob's shared components in `apps/web/src/components/` become shadcn components (preset b0). The heavy overlays (dialogs, menus, popovers) are real shadcn/Base UI components loaded just after the page appears. The first-load pieces (avatar, empty state, skeleton, icons) are shadcn and stay light. Shippable as one PR.

**Architecture:** Every public component in `components/` keeps its name and props, so its ~60 callers do not change. Overlays render through one lazy boundary (`lib/overlays.ts`): the shadcn/Base UI code lives in its own chunk. The app preloads that chunk once, idle, after first paint, and a component that opens before the chunk arrives suspends for that moment. A guard in `scripts/bundle-budget.mjs` fails the build if Base UI overlay code ever reaches the first load. Legacy markup rendered inside a shadcn overlay is marked as a legacy island, so the preflight repair from phase 1 still reaches it.

**Tech Stack:** shadcn CLI (`shadcn@latest add …`, style base-nova), `@base-ui/react` 1.9, `lucide-react`, `cn`, Tailwind v4.3, React 19 `lazy`/`Suspense`, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md`; ADR 0043.

**Decisions this plan rests on (made with the user on 2026-10-30):**
- Overlays load after the page appears (option A). Measured with production minification, gzipped: Base UI Dialog 23 KB, Menu 60 KB, Dialog + Menu + AlertDialog 63 KB, all overlays 76 KB. On the first load that would land at roughly 290–300 KB, past the 260 KB ceiling.
- First-load additions are budgeted: `cn` 10.6 KB, Base UI Avatar 4.2 KB, 40 Lucide icons 5.4 KB (replacing 2.1 KB of hand-traced icons).
- Toasts stay on the first load, keeping Blob's engine and wearing shadcn's look. The live region must be in the document before the first announcement. A lazy Base UI toast (25.6 KB) could not provide that.
- The design listed form controls (Input, Select, Switch, Tabs, Table, …) for phase 2. Each arrives with its first caller in phase 3 instead, so nothing ships unused.

## Global Constraints

- Work in the worktree `/Users/magnetoid/c/blob-shadcn`, on branch `shadcn-2-primitives` cut from `origin/main` (7acc9501 or later). Never touch `/Users/magnetoid/c/blob`.
- The first load is at most 260 KB gzipped. Raise `BUDGET_KB` only to what was measured, in the commit that says why.
- No Base UI overlay code (dialog, alert-dialog, menu, popover, the floating-ui positioning it uses) in the first load. `bundle-budget.mjs` enforces this.
- Public component names and props in `components/` stay unchanged. Callers outside `components/` are not edited in this phase, except to remove an import of a component this phase deletes.
- Behaviours that must survive (anti-goals in the spec):
  - one Escape closes one layer;
  - focus returns to the opener;
  - arrow keys walk menu items;
  - a menu is suspended while a dialog it opened is up;
  - the 44px coarse-pointer minimum;
  - a dialog renders and runs nothing until opened.
- The toast live region exists in the document before the first toast. This is why Toasts stays a first-load component.
- Every task adds an `@source` line in `styles/index.css` for each file it converts to Tailwind classes, and extends the allow-list in `styles/tokenNames.test.ts` to match. It never adds a whole directory that still holds legacy markup.
- No font, icon or script from a CDN.
- Python is untouched. If any pytest runs: `DATABASE_URL=postgres://blob:blob@localhost:5432/blob_shadcn_test REDIS_URL=redis://localhost:6379/14`.
- Dev servers only if :3000 and :5173 are free. The API runs on the dev DB `blob_shadcn_dev` with Redis db 13. Never migrate the shared `blob` DB.
- Merge only on the user's explicit go-ahead, after all four CI jobs pass on GitHub, by hand with `--match-head-commit`. Never `--auto` and never the app's auto-merge.

## Review Focus

1. A person clicks a message's "⋯" menu in the first second after load, before the overlay chunk arrives. Expected: the menu opens once the chunk lands, with no error and no lost click (Task 1 test).
2. A feature dialog's legacy body (forms, buttons, headings rendered by the 17 callers) inside a shadcn Dialog. Expected: it looks as it did, with no preflight regression such as unstyled `<button>`, `svg` going `display:block`, or `h2` margins (Task 2 test plus the visual pass).
3. A menu item that opens a dialog, with Escape pressed once and then again. Expected: the first Escape closes only the dialog, the second only the menu, and focus lands back on the menu's trigger (Task 3 test).
4. The overlay chunk fails to load (offline or a deploy mid-session). Expected: the overlay does not crash the workspace. An error boundary shows nothing and logs, and the next open retries the import (Task 1 test).
5. Reduced motion. Expected: dialogs, menus and popovers still fade but do not move, under the token policy (Task 2 test reads the CSS for `prefers-reduced-motion` covering `data-starting-style`/`data-ending-style`).

---

### Task 1: The lazy overlay boundary and its guard

**Files:**
- Create: `apps/web/src/lib/overlays.ts`, `apps/web/src/lib/overlays.test.ts`
- Create: `apps/web/src/components/overlays/index.ts`, the barrel the chunk is built from, empty of implementations for now
- Create: `apps/web/src/components/lazyOverlay.tsx`, `apps/web/src/components/lazyOverlay.test.tsx`
- Create, via the CLI: `components/ui/dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`. Run `pnpm dlx shadcn@latest add dialog alert-dialog dropdown-menu popover` from `apps/web`.
- Modify: `apps/web/src/app/App.tsx` (call `preloadOverlays()` once after mount), `scripts/bundle-budget.mjs` (overlay guard), `apps/web/src/styles/index.css` and `tokenNames.test.ts` (one `@source` per converted file, with the allow-list updated)

**Interfaces:**
- Produces:
  - `loadOverlays(): Promise<OverlayModule>`, where `OverlayModule = typeof import('../components/overlays/index.ts')`. It memoises the promise and clears the memo on rejection, so the next call retries.
  - `preloadOverlays(): void`. It is idempotent, and schedules `loadOverlays()` with `requestIdleCallback`, falling back to `setTimeout(…, 1)`.
  - `lazyOverlay<P>(pick: (m: OverlayModule) => ComponentType<P>): ComponentType<P>`. This is a `React.lazy` inside `<Suspense fallback={null}>` and an error boundary that renders `null` and logs `console.error` once.
- The guard is `OVERLAY_SDK`, a regex in `bundle-budget.mjs` matching a string that only Base UI's overlay or floating-ui code carries in the minified build. Pick it by building once with an eager import: it must match then and not after.

- [ ] **Step 1: Write the failing tests.**
  - `overlays.test.ts`:
    - `it('loads the overlay chunk once however many ask')`: two calls return the same promise.
    - `it('tries again after a failed load')`: mock the import to reject once. The second call resolves.
    - `it('preloads only once, and only when idle')`: with fake timers, `requestIdleCallback` is stubbed, called once over three `preloadOverlays()` calls.
  - `lazyOverlay.test.tsx`:
    - `it('renders the overlay once its chunk arrives')`: a deferred promise, so nothing renders before resolve and the content renders after.
    - `it('renders nothing and keeps the page up when the chunk fails')`: the sibling content stays in the document.
- [ ] **Step 2: Run** `pnpm --filter @blob/web exec vitest run src/lib/overlays.test.ts src/components/lazyOverlay.test.tsx`. Expect FAIL, because the modules are missing.
- [ ] **Step 3: Implement** the three modules, the CLI add, the `App.tsx` call (in an effect that runs once after first paint) and the guard. The CLI output keeps its own style; the lint override for `components/ui` already exists.
- [ ] **Step 4: Prove the guard.** Temporarily import `@base-ui/react/menu` from `App.tsx`, run `pnpm build && node scripts/bundle-budget.mjs`, and expect it to fail naming the guard. Remove the import, rebuild, and expect a pass. Record both outputs.
- [ ] **Step 5: Run** the focused tests, then the full web vitest, typecheck and lint. All must be green.
- [ ] **Step 6: Commit** `feat(web): shadcn overlays live behind one lazy boundary, preloaded after first paint`.

### Task 2: Dialog, DialogPresence, ConfirmDialog and ShortcutHelp on shadcn

**Files:**
- Create: `components/overlays/DialogImpl.tsx`, `components/overlays/ConfirmDialogImpl.tsx`, exported from the barrel
- Modify: `components/Dialog.tsx` (public `Dialog` and `DialogPresence<T>` keep their props and render via `lazyOverlay`), `components/ConfirmDialog.tsx`, `components/ShortcutHelp.tsx` (onto `Dialog` if it is not already)
- Modify: `styles/app/base.css`, the preflight-repair selector (legacy islands, see Step 3)
- Delete: the legacy rules for these dialogs in `styles/app/dialogs-settings.css` and `overlay-motion.css`, only the rules whose selectors these components rendered
- Test: rewrite `components/Dialog.test.tsx` and `ConfirmDialog.test.tsx`; add `styles/legacyIsland.test.ts`

**Interfaces:**
- Consumes: `lazyOverlay`, `OverlayModule` (Task 1); `components/ui/dialog.tsx` and `alert-dialog.tsx`.
- Produces:
  - Blob's dialog body is wrapped in `<div data-legacy>`.
  - The repair block's condition becomes: outside any `[data-slot]`, OR inside a `[data-legacy]` but not inside a `[data-slot]` nested within it.
  - Later phases render legacy children inside shadcn components the same way.

- [ ] **Step 1: Write the failing tests.**
  - Keep the behaviours of the current test names that still apply. Each test awaits the lazy chunk, with the boundary resolved in test setup.
    - `is a modal dialog with the name it was given`
    - `closes on Escape`
    - `closes on a click that lands on the backdrop, and not on one inside`
    - `closes once, however many ways it was asked`
    - `puts focus back where it came from`
    - `renders nothing, and runs nothing, until it is opened`
    - `keeps the thing it was opened for while it leaves` (DialogPresence)
    - `mounts a new dialog when it is reopened before the old one has gone`
  - ConfirmDialog:
    - `asks in the words it was given`
    - `confirms once`
    - `closes on cancel`
    - `closes on Escape`
    - `colours a destructive answer differently`
  - `legacyIsland.test.ts` (CSS text): the repair block's selector includes the legacy-island clause and excludes a `[data-slot]` nested in an island. A test reads the CSS for `@media (prefers-reduced-motion: reduce)` rules that zero transforms on `[data-starting-style]` and `[data-ending-style]` (Review Focus 5).
  - Delete the tests of `usePresence`/`letGo` mechanics that no longer exist, and say which in the commit.
- [ ] **Step 2: Run** the three files. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `DialogImpl` uses shadcn `Dialog` with `open`/`onOpenChange`.
  - `DialogPresence<T>` holds the last non-null value through Base UI's exit, keyed off `onOpenChangeComplete`.
  - `ConfirmDialogImpl` uses shadcn `AlertDialog`, with a destructive answer on `variant="destructive"`.
  - Escape and the shared stack: register the open dialog with `lib/useEscape.ts`'s stack so a menu under it stays suspended (existing contract). Base UI's own Escape closes the dialog; `useEscape` must not close a second layer.
  - The legacy-island selector goes in `base.css`.
  - Delete only the dead legacy CSS.
- [ ] **Step 4: Run** the focused tests, then the full web vitest, typecheck and lint.
- [ ] **Step 5: Commit** `feat(web): dialogs are shadcn's, loaded after first paint; legacy bodies stay legacy islands`.

### Task 3: Menu on shadcn DropdownMenu

**Files:**
- Create: `components/overlays/MenuImpl.tsx`, exported from the barrel
- Modify: `components/Menu.tsx` (public `Menu` keeps its props and renders via `lazyOverlay`)
- Delete: Menu's legacy rules in `styles/app/overlay-motion.css` and any menu-only file
- Test: rewrite `components/Menu.test.tsx`

**Interfaces:**
- Consumes: Task 1's boundary, Task 2's Escape-stack registration, `components/ui/dropdown-menu.tsx`.

- [ ] **Step 1: Write the failing tests.** Keep these current names and behaviours:
  - `walk its items`
  - `wrap round the end`
  - `leave a select in the panel to its own options`
  - `leave a text field in the panel to its own caret`
  - `answers Escape`
  - `returns focus to its opener`
  - `closes on a click outside the panel`
  - `stays open for a click on its own contents`
  - `is suspended while the caller has a dialog up`
  - `does not also reach the shell`
  - `and leaves the key alone while the caller has a dialog up`
  - Add `one Escape closes the dialog a menu item opened, the next closes the menu, and focus lands on the trigger` (Review Focus 3).
  - Add `a click before the chunk arrives opens the menu once it lands` (Review Focus 1). Hold the lazy promise, click the trigger, resolve, and expect the menu open.
- [ ] **Step 2: Run** the file. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The trigger is Blob's own first-load button: it records the open request in state, and the lazy `MenuImpl` mounts open.
  - Before the chunk lands, the trigger shows `aria-busy="true"`.
- [ ] **Step 4: Run** the focused test, then the full web vitest, typecheck and lint.
- [ ] **Step 5: Commit** `feat(web): menus are shadcn's DropdownMenu, opened even when clicked before they load`.

### Task 4: PersonCard and the EmojiPicker shell on shadcn Popover; Confirmation and Toasts restyled

**Files:**
- Create: `components/overlays/PopoverImpl.tsx`, exported from the barrel
- Modify: `components/PersonCard.tsx` and `components/EmojiPicker.tsx`
  - The shell becomes a lazy shadcn Popover.
  - The picker's grid, search and keyboard model stay as they are, inside a legacy island.
- Modify: `components/Confirmation.tsx`, restyled with Tailwind utilities to shadcn's muted note. It keeps its `usePresence` motion, since it is an inline note and not an overlay.
- Modify: `components/Toasts.tsx`, which stays first-load, keeps its engine and live region, and is restyled with Tailwind utilities to shadcn's toast look (card, border, shadow, radius, muted description)
- Delete: the matching legacy CSS (`toasts.css`, and the popover and person-card rules)
- Test: `PersonCard.test.tsx`, `EmojiPicker.test.tsx` and `Toasts.test.tsx` updated; every current Toasts test keeps passing unchanged in behaviour

- [ ] **Step 1: Write the failing tests.**
  - `PersonCard opens from its trigger, closes on Escape, returns focus`
  - `EmojiPicker opens on its trigger and inserts the chosen emoji`, keeping the existing keyboard tests
  - Toasts: `is in the document before there is anything to announce` stays. Add `renders with the shadcn toast surface` by asserting the `data-slot="toast"` attribute the restyle adds.
- [ ] **Step 2: Run** the three files. Expect FAIL where new.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the focused tests, then the full web vitest, typecheck and lint.
- [ ] **Step 5: Commit** `feat(web): person card and emoji picker open in shadcn popovers; toasts and notes wear shadcn's look`.

### Task 5: First-load primitives: Avatar, EmptyState, ListSkeleton, Icon → Lucide, and the budget

**Files:**
- Create, via the CLI: `components/ui/avatar.tsx`, `skeleton.tsx`, `empty.tsx`
- Modify: `components/Avatar.tsx` (`Avatar({user, size})` and `AvatarWithPresence` keep their props; presence dot unchanged), `components/EmptyState.tsx`, `components/ListSkeleton.tsx`
- Modify: `components/Icon.tsx`
  - All 40 named exports and the `size` scale (`sm` 14, `md` 16, `lg` 18, `xl` 20, with their strokes) stay.
  - Each export becomes a thin wrapper over a Lucide icon of the same meaning.
  - No hand-drawn path data remains.
- Modify: `apps/web/src/lib/utils.ts` and the Vite config, only if the `cn` build mode (`cn/vite`, the package's documented "cn build") measures smaller in the first load than `export { cn } from "cn"`
- Modify: `scripts/bundle-budget.mjs` `BUDGET_KB` to the measured number, at most 260
- Delete: the matching legacy CSS (`avatars-presence.css` avatar rules, `empty-states.css`, `loading-skeleton.css`), only the rules for these components
- Test: `Avatar.test.tsx`, `EmptyState.test.tsx`, `ListSkeleton.test.tsx`, a new `Icon.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - `Icon.test.tsx`:
    - `every export renders a Lucide svg at its role's size`: iterate the module's exports and assert the `lucide` class and `width === height === {14|16|18|20}`.
    - `carries no hand-drawn paths`: the source text of `Icon.tsx` contains no `<path d=`.
  - Avatar:
    - `shows initials until the image loads, and the image after`
    - `keeps the presence dot`
  - EmptyState and ListSkeleton: the existing behaviour tests keep passing, and the new `data-slot` is asserted.
- [ ] **Step 2: Run** them. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Measure `cn` in both modes with `pnpm build && node scripts/bundle-budget.mjs`, keep the smaller, and record both numbers.
  - Set `BUDGET_KB` to the measured total, rounded up to a whole KB, at most 260. The commit message gives the before and after numbers and why.
- [ ] **Step 4: Run** the focused tests, the full web vitest, typecheck, lint and the build plus budget.
- [ ] **Step 5: Commit** `feat(web): avatars, empty states, skeletons and icons are shadcn's and Lucide's; first-load budget set to <measured>`.

### Task 6: Record it, gate it, look at it

**Files:**
- Modify: ADR 0043, adding an addendum on phase 2:
  - overlays behind the lazy boundary, with the measured sizes and the user's choice of option A;
  - the guard;
  - toasts kept first-load for the live region;
  - legacy islands;
  - the new budget.
- Modify: CLAUDE.md "The design layer":
  - the overlays bullet: dialogs and menus are Base UI's now, `usePresence` remains for panels, notices, the typing line and inline notes;
  - the legacy-island rule;
  - "only the first is built" → "the first two".

- [ ] **Step 1: Write** the addendum and the CLAUDE.md edits.
- [ ] **Step 2: Gate.** Run `pnpm check` with the Python env from Global Constraints, then `uv run alembic check`, then `torsor guard --strict --severity error $(git ls-files '*.py')`, then `pnpm build && node scripts/bundle-budget.mjs`. All must be green.
- [ ] **Step 3: Visual pass.**
  - Dev servers (Global Constraints), Playwright, at 400 and 1440 px, light and dark, screenshots into the SDD workspace `screens/`:
    - a feature dialog with a form (Admin → a confirm or install dialog)
    - ConfirmDialog
    - the shortcut help
    - a message's "⋯" menu
    - the person card
    - the emoji picker
    - a toast
    - an empty state
    - a loading list
    - the channel view (avatars, icons)
  - Compare each feature-dialog body against `origin/main`, for the legacy island.
- [ ] **Step 4: Commit** `docs: ADR 0043 addendum and CLAUDE.md for phase 2`. Do not push. The controller runs the final review, then pushes and opens the PR.
