# shadcn Phase 5 — The Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The conversation is drawn with shadcn components (preset b0) and Tailwind utilities. That covers:
- the message list and its rows, reactions, attachments, code blocks and agent run cards;
- the unread and typing notices;
- the composer;
- the right-hand panel.

Every menu and popover in it owns its trigger, and phase 2's menu and popover scaffolding is deleted. The phase's three acceptance items from the 2026-11-05 UX review are met. It ships as three PRs, each finished on its own.

**Architecture:** The spec lets phases 5 and 6 "ship as several PRs split by screen, each one finished on its own". Phase 5 is three, stacked:

| PR | Branch | Cut from | What it does |
|---|---|---|---|
| **5a** Menus and popovers | `shadcn-5-conversation` | main 6916ce47 | MessageMenu → `DropdownMenu`; SchedulePicker → `Popover`; PersonCard and both emoji pickers → `PopoverTrigger`. Then the phase-2 scaffolding goes. |
| **5b** The message list | `shadcn-5b-message-list` | 5a's tip | Rows, reactions, attachments, link previews, code blocks, agent run cards, polls, voice, the unread and typing notices, the start-of-channel intro |
| **5c** The composer and the right-hand panel | `shadcn-5c-composer-panel` | 5a's tip | The composer and its autocomplete, the file tray, the thread panel (the "N replies" divider and Follow), the file and pinned panels |

5a goes first because it is behaviour, not paint, and both later PRs re-skin files it touches: `MessageRow.tsx` and `Composer.tsx`. 5b and 5c touch different files and can be built in either order. Each is rebased onto main once the PR under it merges.

5a builds on phase 4's `components/lazyDropdown.tsx`. A popup module, written as an ordinary shadcn `DropdownMenu` or `Popover` with its own trigger, is imported lazily and preloaded with the overlay chunk. A placeholder draws the trigger until the module arrives. Task 1 generalises that into `lazyTrigger`, which serves popovers as well as menus. It can also wait to mount a row's popup until the first press, so a virtualised list does not mount Base UI roots for rows nobody touched. It shares one loader, `lib/lazyModule.ts`, with ⌘K. That is phase 4's follow-up.

**Tech Stack:** shadcn CLI 4.23 (style base-nova), `@base-ui/react` 1.9, `lucide-react`, Tailwind v4.3, `cn` in build mode (`src/lib/cn-tables.ts`), vitest + happy-dom, Playwright (Chromium, Firefox, WebKit) for the production-bundle smoke.

**Spec:** `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md`, phase 5, with its exit list and acceptance items. ADR 0043 and its phase 2 and phase 4 addenda.

**The acceptance items, and where each is met:**

| Item (spec, phase 5) | PR |
|---|---|
| A channel with little history opens onto the start-of-channel intro ("This is the very beginning of #name", with its description) once the whole history is loaded | 5b |
| The thread panel sets the root apart from the replies with an "N replies" divider under it | 5c |
| The thread header's Follow is a real button (outline or ghost) that shows its state | 5c |
| No caller of `components/Menu.tsx` or `components/Popover.tsx` is left; the pickers open from their own triggers; the scaffolding listed in the spec is deleted | 5a |
| A menu inside a dialog takes its own Escape (`Opening`'s `holds`) | 5a |
| Motion stays keyed to arriving, never to mounting (`freshMessages`, `Count.tsx`, `lib/firstView.ts`) | 5b (re-verified in 5c) |

**Calls made without the user** (recorded in ADR 0043's phase 5 addendum as each PR lands):
- **Three PRs, stacked, split as above.** 5a is the only one that changes behaviour; 5b and 5c are paint, each with its own acceptance items.
- **A message row's popups mount on first press** (`mount: 'press'`). The list is virtualised, so a row mounts on every scroll. Each row has three popups (More actions, Add reaction, the person card) and would otherwise carry three closed Base UI roots, rebuilt on every scroll. Until someone presses, the row draws the placeholder trigger, which looks and reads the same. The press opens the popup in the same render once the module is here. Phase 4's channel rows keep `mount: 'arrival'`.
- **"Remind me…" becomes a submenu** (`DropdownMenuSub`) of its presets, as in Slack. Today its presets unfold inline inside the menu.
- **The row's toolbar stays up while one of its popups is open.** The rule is `.message:has([data-popup-open]) .message-actions`, because Base UI marks the open trigger with `data-popup-open`. The panel is no longer drawn inside the row, so `:focus-within` and `:hover` no longer hold the toolbar up.
- **A dialog opened from a message's menu gives focus back to the message row** when it closes, not to More actions. By then the toolbar is hidden, and a `visibility: hidden` button cannot take focus.
- **A popup whose module will not load says so.** The toast reads "Couldn’t open ⟨name⟩. Reload the page to try again." Offline, it says it cannot open while offline. This is ⌘K's wording from phase 4 (WebKit keeps a failed import until a reload), now in one place for every lazy popup. Today a menu's failed load is only logged.
- **SchedulePicker is a dialog-kind popover** (`aria-haspopup="dialog"`). It holds a list of presets, a Repeat select and a time field, and under ARIA a select and a date field are not menu items. The spec says so.

## Global Constraints

- **Workspace.**
  - 5a: `/Users/magnetoid/c/blob-shadcn-5`, branch `shadcn-5-conversation`, from `origin/main` at 6916ce47.
  - 5b and 5c: their own branches in the same worktree, cut from 5a's tip when 5a's final review is done.
  - Never touch `/Users/magnetoid/c/blob` or another worktree.
  - Tests use `DATABASE_URL=postgres://blob:blob@localhost:5432/blob_shadcn_test` and `REDIS_URL=redis://localhost:6379/14`; dev uses `blob_shadcn_dev` and Redis db 13 (the worktree's `.env`).
- **Disk.** The data volume runs at about 4–5 GB free. Check `df -h /System/Volumes/Data` before a full gate or a build, and stop at under 2 GB.
- **First load.**
  - At most 260 KB gzipped, and `node scripts/bundle-budget.mjs` green, including its `OVERLAY_SDK` guard and the stylesheet budget.
  - No first-load module may statically import `components/ui/{dialog,sheet,dropdown-menu,popover,tooltip,command}.tsx` or anything that reaches them. Reach them through `lazyOverlay`, `lazyTrigger`/`lazyDropdown`, or a lazy chunk.
  - Change `BUDGET_KB` or `CSS_BUDGET_KB` only in each PR's last task, to what was measured (rounded up, plus 1 KB), in the commit that says why. A PR that shrinks the first load lowers them.
- **Callers outside the conversation are not edited.** The exceptions, each limited to what is named:
  - `components/lazyDropdown.tsx`, `features/palette/lazyPalette.ts` (Task 1: onto the shared loader, with their behaviour and strings unchanged);
  - `components/Dialog.tsx` (5a: the return-focus target and `holds`);
  - `components/ui/*`, `components/overlays/*`, `lib/overlays.ts`;
  - `styles/**` (deleting rules whose last user was converted);
  - `scripts/bundle-budget.mjs`;
  - `e2e/contract.e2e.ts`, only if a locator must change.

  Activity, Saved/Later, Scheduled, Drafts, Files and Threads (the `*View.tsx` files in `features/messages/`) are phase 6's, unless they render a component this phase converts.
- **Legacy CSS.** Delete a rule only when no file under `apps/web/src` still renders its class (grep it). The shared `.menu`, `.menu-item` and `.menu-sep` rules stay while `ArtifactsTab` and `ForwardDialog` draw them (phase 6).
- **Tailwind sources.** Each converted file gets an `@source` line in `styles/index.css`, and the allow-list in `styles/tokenNames.test.ts` grows to match. Never add a directory that still holds unconverted markup.
- **Behaviours that must survive** (the spec's anti-goals):
  - one Escape closes one layer;
  - focus returns to the opener;
  - the arrow keys walk menus and lists;
  - the 44px minimum under `@media (pointer: coarse)`;
  - motion keyed to arriving, never to mounting;
  - no axe regression, and no muted grey under 4.5:1.
- **Tests** prefer roles and labels over classes. Every new behaviour test must fail without the change it tests (check by reverting the source, then restore it).
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `git stash`, `reset` or switch branches in a way that would discard work.

## Review Focus

Things the spec implies, ranked by how likely each is to bite a real person:

1. **The pointer leaves a row while its menu or picker is open.** The toolbar stays up and the panel stays where it was. Both go once the panel closes and the pointer is elsewhere.
   *Pinned by:* Task 2's `data-popup-open` test, and the smoke step in Task 6.
2. **A dialog opened from a message's menu is closed** (Earlier versions, Log a decision, Forward…). Focus lands on the message row, not on `<body>`.
   *Pinned by:* Task 2.
3. **Somebody presses a row's More actions, Add reaction or name within the first second after load.** The popup opens when its module lands. A module that will not load says to reload the page, rather than doing nothing (WebKit keeps the failure).
   *Pinned by:* Task 1, and per caller in Tasks 2, 4 and 5.
4. **A long channel is scrolled quickly.** No row draws a Base UI root until its popup is pressed, and a row pressed just after the scroll opens.
   *Pinned by:* Task 2's "no root until pressed" test, repeated for the picker (Task 5) and the card (Task 4).
5. **The schedule picker is used by keyboard.** The Repeat select and the time field keep their own arrow keys. Escape from inside either closes the popover (one layer), and focus returns to the clock.
   *Pinned by:* Task 3.

---

# PR 5a: menus and popovers own their triggers

### Task 1: `lazyModule` and `lazyTrigger`

**Files:**
- Create: `apps/web/src/lib/lazyModule.ts`, `apps/web/src/components/lazyTrigger.tsx`
- Modify:
  - `apps/web/src/components/lazyDropdown.tsx`: becomes a one-line wrapper over `lazyTrigger`, keeping its export and props;
  - `apps/web/src/features/palette/lazyPalette.ts`: onto `lazyModule`, keeping `PALETTE_FAILED`, `PALETTE_OFFLINE`, `loadPalette` and its behaviour.
- Test: `apps/web/src/lib/lazyModule.test.ts`, `apps/web/src/components/lazyTrigger.test.tsx`. The existing `lazyDropdown.test.tsx` and `lazyPalette.test.tsx` must pass unchanged.

**Interfaces:**
- Produces:
  ```ts
  // lib/lazyModule.ts
  export function failureMessage(name: string, online?: boolean): string;
  //  online (default navigator.onLine !== false):
  //    `Couldn’t open ${name}. Reload the page to try again.`
  //  offline:
  //    `Couldn’t open ${name} while you’re offline.`
  export interface LazyModule<T> {
    current(): T | null;                          // the module once it has arrived
    subscribe(onArrive: () => void): () => void;  // told once, when it arrives
    load(): Promise<T>;                           // memoised; a failure is forgotten
    loadForPerson(): Promise<T>;                  // load(), plus: a failure is logged and
                                                  // toasted (failureMessage) once per attempt
  }
  export function lazyModule<T>(importer: () => Promise<T>, name: string): LazyModule<T>;
  //  registered with preloadAlso, so it is fetched beside the overlay chunk

  // components/lazyTrigger.tsx
  export interface TriggerModuleProps { trigger: ReactElement; defaultOpen?: boolean }
  export function lazyTrigger<P extends TriggerModuleProps>(
    load: () => Promise<{ default: ComponentType<P> }>,
    options: { name: string; popup: 'menu' | 'dialog'; mount?: 'arrival' | 'press' },
  ): ComponentType<Omit<P, 'defaultOpen'>> & { preload(): Promise<void> };
  ```
  - `DropdownModuleProps` stays exported from `lazyDropdown.tsx` as an alias of `TriggerModuleProps`.
  - `lazyDropdown(load)` is `lazyTrigger(load, { name: 'this menu', popup: 'menu' })`.
  - `mount` defaults to `'arrival'`, which is phase 4's behaviour.
  - `'press'` draws the placeholder until the first press on it, even when the module is already here. From then on the module stays drawn for that wrapper's life.
  - `popup` is the placeholder's `aria-haspopup`.
  - Everything else is phase 4's `lazyDropdown`, unchanged: the held press, the ways out of it, the Escape layer while waiting, and the focus hand-over on the swap.

- [ ] **Step 1: Write the failing tests.**
  - `lazyModule.test.ts`:
    - `it('loads once for every caller')`
    - `it('tells subscribers once when the module arrives')`
    - `it('asks for a reload, once per attempt, when a load a person asked for fails')`: two `loadForPerson()` calls on one failing attempt give one toast, reading `Couldn’t open search. Reload the page to try again.`
    - `it('says it is offline instead when the browser is offline')`, reading `Couldn’t open search while you’re offline.`
    - `it('asks again on the next load after a failure')`
  - `lazyTrigger.test.tsx`:
    - `it('marks the placeholder with the kind of popup it opens')`: `aria-haspopup="dialog"` for `popup: 'dialog'`.
    - `it('with mount press, draws the placeholder until pressed even once the module is here')`: after `preload()`, no module element is rendered. After a click, the module is rendered with `defaultOpen` true.
    - `it('says so when a pressed module will not load, and stays closed')`: a toast reading `Couldn’t open this menu. Reload the page to try again.`, and the placeholder still has `aria-expanded="false"`.
- [ ] **Step 2: Run them and expect failures.** `pnpm exec vitest run src/lib/lazyModule.test.ts src/components/lazyTrigger.test.tsx`
- [ ] **Step 3: Implement.** Move `lazyDropdown`'s body into `lazyTrigger`, and build its fetch, arrival and failure on `lazyModule`. Then rewrite `lazyPalette`'s loader on `lazyModule(…, 'search')`, so `PALETTE_FAILED === failureMessage('search', true)` and `PALETTE_OFFLINE === failureMessage('search', false)`.
- [ ] **Step 4: Run the new tests and the existing ones.**
  ```bash
  pnpm exec vitest run src/lib src/components src/features/palette src/features/channels src/features/shell
  pnpm typecheck
  pnpm lint
  ```
- [ ] **Step 5: Commit** `feat(web): lazyTrigger — popovers as well as menus, mounted on press, a failed load said once`.

### Task 2: MessageMenu is a `DropdownMenu`

**Files:**
- Create:
  - `apps/web/src/features/messages/MessageMenuPanel.tsx`, the module;
  - `apps/web/src/features/messages/lazyPopups.ts`, this PR's lazy popups, one import each, like phase 4's `features/channels/lazyMenus.ts`.
- Modify:
  - `features/messages/MessageMenu.tsx`: keeps its props, its dialogs and their state; the menu itself moves to the module;
  - `components/Dialog.tsx`, only if it has no way to name where focus goes back: add `returnFocus?: () => HTMLElement | null`, used on close in place of the opener;
  - `styles/app/code-blocks.css`: add the `:has([data-popup-open])` reveal beside `:hover`/`:focus-within`; delete `.message-menu` and `.remind-preset` if nothing else draws them.
- Test: `features/messages/MessageMenu.test.tsx` (rewrite off classes onto roles), and the existing MessageRow tests.

**Interfaces:**
- Consumes: `lazyTrigger` (Task 1).
- Produces: `lazyPopups.ts` exports `MessageMenuPopup = lazyTrigger(() => import('./MessageMenuPanel.tsx'), { name: 'this menu', popup: 'menu', mount: 'press' })`. Tasks 4 and 5 add their entries to this file.

**What it does:**
- The trigger is today's `.message-action` "More actions" button, passed as `trigger`.
- The items are today's, in today's order, each a `DropdownMenuItem`. Each shows under today's conditions: Copy link, Forward…, Start work from here…, Mark unread, Save / Remove from Later, Remind me…, Edit message, Earlier versions, Delete message.
- Delete is `variant="destructive"`.
- Remind me… is a `DropdownMenuSub` whose items are `REMIND_PRESETS`.
- An item that opens a dialog closes the menu first. That dialog returns focus to the message row (`article[data-message-id]`).

- [ ] **Step 1: Write the failing tests.**
  - `it('draws no menu until More actions is pressed')`: before a press, no element with `data-slot="dropdown-menu-trigger"` is in the row.
  - `it('opens from More actions and walks its items with the arrow keys')`: Enter opens, ArrowDown moves `document.activeElement` from the first menuitem to the second.
  - `it('marks More actions while open, which the toolbar keys on')`: `data-popup-open` is present while open and absent after Escape.
  - `it('closes on Escape and gives focus back to More actions')`
  - `it('offers the reminder presets as a submenu, and one saves a reminder')`: `api.later.update` is called with the message id and a `remindAt` ISO string.
  - `it('gives focus back to the message when a dialog from the menu closes')`: Earlier versions, as an admin on an edited message, then Escape. `document.activeElement` is the row's `article`.
  - The existing assertions about who sees Edit and Delete are kept.
- [ ] **Step 2: Run them and expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the messages tests, `pnpm typecheck` and `pnpm lint`.** Then `pnpm build` and `node scripts/bundle-budget.mjs`. Note in the report what the first load measured (`MessageMenuPanel` must not be in a chunk `index.html` names).
- [ ] **Step 5: Commit** `feat(web): a message's More actions is shadcn's DropdownMenu, mounted on press`.

### Task 3: SchedulePicker is a `Popover`

**Files:**
- Create: `apps/web/src/features/messages/SchedulePanel.tsx`, the module.
- Modify:
  - `features/messages/SchedulePicker.tsx`: the clock trigger, and the step-aside rule while the tray holds a file;
  - `features/messages/lazyPopups.ts`;
  - `styles/app/scheduling.css`: delete what the panel no longer draws.
- Test: `features/messages/SchedulePicker.test.tsx`.

**Interfaces:**
- Consumes: `lazyTrigger`.
- Produces: `SchedulePopup = lazyTrigger(() => import('./SchedulePanel.tsx'), { name: 'scheduling', popup: 'dialog' })`, with `mount` at its default.

**What it does:**
- A `Popover` with `PopoverTrigger render={trigger}` and `PopoverContent side="top" align="end" sideOffset={6}`, named as the clock button names it today.
- Inside, in today's order:
  - the presets, as buttons;
  - a `Separator`;
  - Repeat, as `components/ui/native-select.tsx`;
  - "Or pick a time", as `Input type="datetime-local"`, with its button.
- What each one sends is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `it('opens a dialog from the clock, named for scheduling')`: role `dialog`, and the clock has `aria-haspopup="dialog"`.
  - `it('leaves the arrow keys to the Repeat select')`: ArrowDown on the focused select leaves `document.activeElement` on the select.
  - `it('closes on Escape from the time field and gives focus back to the clock')`
  - `it('schedules a preset and closes')`: the existing assertion on the scheduled-send call, then the dialog is gone.
  - Kept: the clock steps aside while the tray holds a file, and says why.
- [ ] **Step 2: Run them and expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the messages tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): scheduling a message is shadcn's Popover`.

### Task 4: PersonCard opens from its own trigger

**Files:**
- Modify:
  - `apps/web/src/components/PersonCard.tsx`: its default export becomes the module, `<Popover defaultOpen>` + `PopoverTrigger render={trigger}` + `PopoverContent`, named for the person, with the card's content in Tailwind;
  - `features/messages/MessageRow.tsx`: the avatar and name triggers, with `cardOpen` and its effects gone;
  - `features/messages/lazyPopups.ts`;
  - `styles/app/who-somebody-is.css`: delete what the card no longer draws.
- Test: `components/PersonCard.test.tsx`, and the MessageRow tests that open a card.

**Interfaces:**
- Consumes: `lazyTrigger`.
- Produces: `PersonCardPopup = lazyTrigger(() => import('../../components/PersonCard.tsx'), { name: 'this profile', popup: 'dialog', mount: 'press' })`, with props `{ trigger; userId: string }` plus whatever the card takes today.

- [ ] **Step 1: Write the failing tests.**
  - `it('draws no card root until the name is pressed')`
  - `it('opens the author’s card from their name, named for them')`
  - `it('closes on Escape and gives focus back to the name')`
  - Kept: every action the card offers today (for example, messaging them), by role.
- [ ] **Step 2: Run them and expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): the person card is shadcn's Popover, opened from its own trigger`.

### Task 5: both emoji pickers open from their own triggers

**Files:**
- Create: `apps/web/src/components/EmojiPopover.tsx`, the module: `<Popover defaultOpen>` + `PopoverTrigger render={trigger}` + `PopoverContent side align sideOffset aria-label={label}` round `EmojiPicker`.
- Modify:
  - `apps/web/src/components/EmojiPicker.tsx`: the picker's body only, meaning its search, grid, tones and keys. Gone from it: `PanelAnchor`, `PopoverImpl`, `focusMovedOut` and the pointer-mode tracking. Its markup moves to Tailwind and leaves its `data-legacy` island.
  - `features/messages/MessageRow.tsx`: Add reaction, with `pickerOpen`, its `useEscape` and its outside-click effect gone;
  - `features/messages/Composer.tsx`: Insert emoji, with its open state, anchor and dismissal gone;
  - `features/messages/lazyPopups.ts`;
  - `styles/app/emoji-the-picker-and-custom-emoji-wherever-they-render.css`: delete the picker's rules and its `@property --popover-*`; the custom-emoji rules used in messages stay for 5b.
- Test: `components/EmojiPicker.test.tsx`, the MessageRow reaction tests, the Composer emoji tests, and one in `features/messages/ThreadPanel.test.tsx`.

**Interfaces:**
- Consumes: `lazyTrigger`.
- Produces: `EmojiPopup = lazyTrigger(() => import('../../components/EmojiPopover.tsx'), { name: 'the emoji picker', popup: 'dialog', mount: 'press' })`, with props `{ trigger; label: string; side: 'top' | 'bottom'; align: 'start' | 'end'; onPick(value: string): void }`.
  - Add reaction: `side="bottom" align="end"`, label "React with an emoji".
  - Insert emoji: `side="top" align="start"`, label "Insert an emoji".
  - The 6px gap is the old `--popover-gap`.

**What it does:** Picking closes the picker, as today. Inserting puts the emoji at the caret and gives focus back to the message field, as today.

- [ ] **Step 1: Write the failing tests.**
  - `it('draws no picker root until Add reaction is pressed')`
  - `it('opens with the cursor in its search')`
  - `it('reacts with the first result on Enter, and closes')`
  - `it('inserts at the caret and gives focus back to the message field')`, in Composer.
  - `it('takes one Escape in a thread: the picker closes and the thread stays')`, in ThreadPanel.
  - Kept: the workspace's own emoji come first, and the skin tone is remembered.
- [ ] **Step 2: Run them and expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): the emoji pickers are shadcn's Popover, opened from their own triggers`.

### Task 6: the scaffolding goes, and the PR is recorded

**Files:**
- Delete, each only once a grep shows nothing left that imports it:
  - `components/Menu.tsx`, `components/Popover.tsx`, `components/PanelAnchor.tsx`, `components/menuItems.ts`;
  - `components/overlays/MenuImpl.tsx`, `components/overlays/PopoverImpl.tsx`, `components/overlays/inPlace.ts`, and their exports in `components/overlays/index.ts`;
  - `lib/useDismissal.ts`, `lib/useHeldThroughExit.ts`;
  - their tests, including the `[data-base-ui-focus-guard]` canary in `Menu.test.tsx` and `Popover.test.tsx`;
  - the `@property --menu-*` rules and every `--menu-side`, `--menu-align`, `--menu-gap` declaration (`channel-menu-and-details.css`, `scheduling.css`);
  - any `--popover-*` placement property left after Task 5. shadcn's colour token `--popover-foreground` stays.
- Modify:
  - `components/Dialog.tsx`: `Opening`'s `holds`, only if Step 1's test fails;
  - `scripts/bundle-budget.mjs`: the budgets, measured;
  - `.torsor/architecture/decisions/0043-blob-takes-shadcns-look.md`: add a "Phase 5a" addendum;
  - `CLAUDE.md`'s design-layer digest, wherever it names the deleted files or the in-place panels;
  - the spec's phase 5 line: "5a done in #NN" once the PR has a number.
- Test: `components/Dialog.test.tsx`.

- [ ] **Step 1: Write the failing test** `it('lets a menu inside a dialog take the first Escape, and the dialog the second')`. Use a real `DropdownMenu` from `components/ui/dropdown-menu.tsx`, opened inside `Dialog`. The first Escape closes the menu and leaves the dialog open with focus on the menu's trigger; the second closes the dialog. If it passes as written, note in the report that `holds` needed no change, and why.
- [ ] **Step 2: Delete the scaffolding and run `pnpm check`.** Check `df -h /System/Volumes/Data` first. Then run `uv run alembic check` and `torsor guard --strict --severity error` from the repo root.
- [ ] **Step 3: Confirm nothing is left.** This grep over `apps/web/src` must return nothing:
  ```bash
  grep -rnE "components/Menu|components/Popover|PanelAnchor|useDismissal|useHeldThroughExit|MenuImpl|PopoverImpl|inPlace|data-base-ui-focus-guard|--menu-(side|align|gap)|--popover-(side|align|gap)" apps/web/src
  ```
- [ ] **Step 4: Measure.** Run `pnpm build && node scripts/bundle-budget.mjs`, then set `BUDGET_KB` and `CSS_BUDGET_KB` to the measure rounded up, plus 1 KB. Grep every chunk `index.html` names for `MessageMenuPanel`, `SchedulePanel`, `EmojiPopover` and the PersonCard module's code; none may be there.
- [ ] **Step 5: Record and commit** `refactor(web): phase 2's menu and popover scaffolding goes — every popup owns its trigger`. The ADR addendum covers the calls above, what was deleted, the `holds` outcome and the budgets.

**Then, the controller, before opening PR 5a:**
- The final whole-branch review and its fix wave.
- The gate.
- Screenshots of a message's menu, the reminder submenu, the schedule picker, a person card and both emoji pickers, at 400 and 1440, light and dark.
- The production-bundle smoke in Chromium, Firefox and WebKit, which checks:
  - each popup by keyboard and by pointer;
  - a press held until its module lands;
  - a module blocked from loading gives the reload toast;
  - the toolbar stays up with the pointer gone while a popup is open (Review Focus 1);
  - focus after a dialog from the menu (Review Focus 2);
  - one Escape for a picker inside the thread panel and inside the phone Sheet.

---

# PR 5b: the message list

Cut from 5a's tip once 5a's final review is done. Its tasks are written into this plan, on its branch, before its first dispatch, from the code as 5a leaves it.

**Scope:**
- Files: `MessageList.tsx` and `MessageRow.tsx` (the row's header, body, grouping, edited/pending/failed states and reaction chips), `BlockRenderer.tsx`, `PollCard.tsx`, `VoicePlayer.tsx`, `AgentRunCard.tsx`, `ReplyFold.tsx`, `MessageTranslation.tsx`, `CatchUpStrip.tsx`, the unread jump bar, the typing line, the way back to the newest message, link previews, attachments in a row, code blocks.
- Their stylesheets, deleted as their last renderer converts: `message.css`, `message-blocks.css`, `code-blocks.css`, the reactions and attachments part of `reactions-attachments-threads.css`, `agent-run-cards.css`, `an-agents-markdown.css`, `a-long-answer-folded.css`, `voice-messages.css`, `typing.css`, `unread-jump-bar.css`, `the-way-back-to-the-newest-message.css`, the strip's part of `catch-me-up.css`, `permalinks.css`, the custom-emoji rules, and `conversation-pane.css` as far as the list goes.

**Acceptance:**
- The start-of-channel intro. Once the whole history is loaded, the list opens onto "This is the very beginning of #name" with the channel's description. A DM says who it is with. It is drawn only when the oldest page is loaded, never above a gap.
- Motion re-verified:
  - a row's entrance plays only while `freshMessages` marks it;
  - nothing replays on scroll or on a channel switch;
  - `Count.tsx` and `lib/firstView.ts` keep their rules.

  A test for each.
- The 44px coarse-pointer minimum on the toolbar's buttons and the reaction chips.

# PR 5c: the composer and the right-hand panel

Cut from 5a's tip. Its tasks are written into this plan, on its branch, before its first dispatch.

**Scope:**
- Files: `Composer.tsx`, `ComposerOptions.tsx`, `FormatToolbar.tsx`, `MessageEditor.tsx`, the mention, emoji and slash autocomplete, the file tray and drop target, `VoiceRecordButton.tsx`, `ThreadPanel.tsx` (with `ThreadSummary.tsx` and `ThreadTasks.tsx` as they sit in it), `FilePreviewPanel.tsx`, `PinnedPanel.tsx`, `CatchUpPanel.tsx`.
- Stylesheets, deleted the same way: `composer.css`, `slash-commands.css`, `autocomplete.css`, `a-file-dropped-on-a-conversation.css`, `right-panel.css`, `a-file-open-in-the-right-hand-panel.css`, the threads part of `reactions-attachments-threads.css`, `threads-you-follow.css`, `a-thread-reply-sent-to-the-channel-too.css`, `preview-gate-ux.css`, the pinned part of `shortcut-list-and-pinned-messages.css`, and the panel's part of `the-frame.css` and `overlay-motion.css`.

**Acceptance:**
- The thread root is set apart from the replies by an "N replies" divider under it ("1 reply", then "N replies").
- Follow in the thread header is a real `Button` (outline when not following, secondary or ghost when following), with `aria-pressed` and the label saying which.
- The panel's enter and exit through `ThreadPanelSlot` and `usePresence` are unchanged.
