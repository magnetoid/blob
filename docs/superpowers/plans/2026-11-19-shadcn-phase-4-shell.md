# shadcn Phase 4 — The Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat shell is drawn with shadcn components (preset b0) and Tailwind utilities:
- the channel list on `components/ui/sidebar.tsx`, inset, with an icon rail and a Sheet below 768px;
- the top bar, with its view tabs gone, so the sidebar is the one navigation;
- the account menu, the workspace switcher, the section menu and ChannelMenu as real `DropdownMenu`s;
- ⌘K as shadcn's `Command`.

The phase's acceptance items from the 2026-11-05 UX review are met, the shell's legacy CSS is deleted, and the first load, JavaScript and stylesheet, ends no bigger than main's. Shippable as one PR.

**Architecture:** Base UI's overlay code must stay out of the first load (phase 2, the user's "(A) Load after page"; `scripts/bundle-budget.mjs`'s `OVERLAY_SDK` guard). The shell draws its menu triggers and the phone Sheet at first paint, so Task 1 builds two pieces of plumbing:
- `lazyDropdown`: a menu module, written as an ordinary shadcn `DropdownMenu` with its own `DropdownMenuTrigger`, is imported lazily and preloaded with the overlay chunk. Until it arrives, a placeholder draws the same trigger without Base UI. A press on the placeholder opens the menu the moment the module lands.
- The Sidebar's mobile Sheet, drawn through `lazyOverlay`.

Task 2 rebuilds the shell on `SidebarProvider` and the channel list on shadcn's `Sidebar`. Task 3 converts the top bar and its two menus. Task 4 converts the channel and section menus. Task 5 moves ⌘K to `Command` in a chunk of its own. Task 6 sweeps the legacy CSS, budgets the stylesheet, and records the phase.

**Tech Stack:** shadcn CLI 4.23 (`pnpm exec shadcn add …`, style base-nova), `@base-ui/react` 1.9, `cmdk` 1.1.1 (the current release, which shadcn's base-nova `command` depends on), `lucide-react`, `cn` in build mode (`src/lib/cn-tables.ts`), Tailwind v4.3, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md`, phase 4 and its acceptance list. That list includes the user's 2026-11-19 decision, "Sidebar only": the top tabs go, every place they reached stays reachable from the sidebar, and old URLs keep working. ADR 0043.

**The phase 4 acceptance items, and the task that meets each:**

| Item (spec, phase 4) | Task |
|---|---|
| The tabs go; Files and Activity are reachable from the sidebar; old URLs keep working | 2 (rows), 3 (tabs removed) |
| On a phone the channel list opens from a trigger that looks like one | 3 |
| At 400px the Search button has room and nothing fades mid-word | 3 |
| The inset frame shows in dark mode | 2 |
| Tasks has a task icon everywhere: sidebar, Home's "Open tasks", the Tasks empty state | 2 |
| The sidebar's icons are centred on their labels | 2 |

**Calls made without the user (recorded in ADR 0043's phase 4 addendum, Task 6):**
- **Menus own their triggers through `lazyDropdown`**, not through phase 2's caller-owned `components/Menu.tsx`. Phase 2's addendum promised that Base UI's own triggers would fix two things by construction: the reopen-on-trigger-click trap and WebKit's lost focus return. A statically imported Base UI menu took the first load 59.6 KB past its budget in phase 2's measurement. So the module is lazy, and only its first few hundred milliseconds are a placeholder.
- **Activity is a new sidebar row beside Mentions,** not a rename of it. `/activity` opens All, `/mentions` opens the Mentions filter, and each highlights its own row. This removes nothing a person already uses. Merging the two rows is left for the user to decide (PR follow-up).
- **Files is a new sidebar row** at `/files`, using the Files glyph that Tasks gives up.
- **Tasks' glyph is Lucide `ListTodo`** (`TaskIcon`). `SquareCheck` reads as one finished item, not a list of them.
- **Activity's glyph is Lucide `Bell`** (`ActivityIcon`), as Slack's Activity is a bell.
- **The trigger for the list is shadcn's `PanelLeft` button at the bar's left.** On a phone it opens the Sheet ("Open channel list"). From 768px it folds the list to its rail ("Hide channel list" / "Show channel list"). The workspace mark becomes a plain mark again, as it is in the consoles.
- **The rail is `collapsible="icon"` at `--sidebar-width-icon: 4rem`.** That is 64px, down from 84px: a 44px row with the badge in its corner. The fold stays persisted in `localStorage` (`blob.sidebar.collapsed`).
- **The narrow breakpoint is 768px everywhere in the shell** (`useIsMobile`'s `max-width: 767px`, Tailwind's `md`). The legacy CSS's `max-width: 768px` and the frame's `min-width: 769px` move by one pixel to match. That is phase 3's choice for the consoles.
- **The dark frame gets a visible ring.** The frame's dark ring goes from 7% white to 14% white (`--elev-frame`, both dark blocks in `tokens.css`). That is about 1.4:1 against the ground, up from 1.2:1. The ground and the card keep b0's values, because Midnight is b0's dark exactly.
- **The palette is its own lazy chunk,** preloaded with the overlays. `cmdk` lands there and never in the first load. It still opens inside `components/Dialog.tsx`, so it keeps its place on the Escape stack.
- **`SidebarMenuButton`'s `tooltip` prop is stripped** from the copied component, with its static `Tooltip` import. Base UI's tooltip would otherwise reach the first load. Rail rows carry their name and Blob's `data-tooltip`, as they do today.

## Global Constraints

- **Workspace.**
  - Work in `/Users/magnetoid/c/blob-shadcn-4`, branch `shadcn-4-shell`, cut from `origin/main` at e6414252.
  - Never touch `/Users/magnetoid/c/blob` or any other worktree.
- **First load.**
  - At most 260 KB gzipped.
  - `node scripts/bundle-budget.mjs` stays green, including its `OVERLAY_SDK` guard.
  - No first-load module may statically import anything that reaches Base UI's dialog, sheet, menu, popover or tooltip: `components/ui/{dialog,sheet,dropdown-menu,popover,tooltip,command}.tsx`. Reach them through `lazyOverlay`, `lazyDropdown` or a lazy chunk.
  - Change `BUDGET_KB` only in Task 6, to what was measured, in the commit that says why.
- **Callers outside the shell are not edited.** The exceptions, each limited to what is named:
  - `features/messages/ChannelView.tsx` (its ChannelMenu trigger only);
  - `features/home/HomeView.tsx` and `features/agentic/TasksView.tsx` (the task icon only);
  - `features/console/ConsoleShell.tsx` (the TopBar island, and whatever the Sheet change in Task 1 needs);
  - `components/ui/*`, `components/overlays/*`, `components/Icon.tsx`, `lib/overlays.ts`;
  - `styles/**` (deleting rules whose last user was converted, and selectors that named the old shell's classes);
  - `scripts/bundle-budget.mjs` (Task 6);
  - `e2e/contract.e2e.ts` only if a locator must change.
  `features/agentic/AgentTerminal.tsx` still draws `.topbar-spacer`, so that rule stays, moved to `an-agents-terminal.css`.
- **The layout.**
  - Every view root stays `main.pane` (`e2e/contract.e2e.ts`), and nothing is nested in a second `<main>`, so `SidebarInset` is not used in the chat shell.
  - `.shell` stays the class of the shell's root, because `the-frame.css` and `calls.css` key on `.shell > .pane` and `.shell > .panel` until phase 5.
  - `data-panel`, `data-panel-kind` and `data-in-call` stay on that root.
- **Legacy CSS.** Delete a rule only when no file under `apps/web/src` still renders its class (grep, or `node <ledger>/cssmap.mjs`). These stay for phases 5–6:
  - `.channel-hash` (`BrowseChannels.tsx`, `SearchView.tsx`);
  - `.section-label` (`ChannelDetails`, `PinnedPanel`, `ShortcutHelp`, `HelpView`);
  - `.menu*` (MessageMenu, SchedulePicker, ArtifactsTab, ForwardDialog);
  - `.presence-dot` (`Avatar.tsx`);
  - `.agent-live-dot` (`AgentsView.tsx`).
- **Tailwind sources.** Each converted file gets an `@source` line in `styles/index.css`, and the allow-list in `styles/tokenNames.test.ts` grows to match. Never add a directory that still holds unconverted markup.
- **Behaviours that must survive** (the spec's anti-goals):
  - one Escape closes one layer;
  - focus returns to the opener;
  - ⌘K, ⌘⇧K and the arrow keys in menus and lists;
  - 44px targets under `pointer: coarse`;
  - axe passes on every page in `e2e/contract.e2e.ts`;
  - muted text at 4.5:1 or better in all twelve presets;
  - a sidebar row's arrival animates once, on arriving, never on mounting (`data-arriving`);
  - a badge pops only when its count changes (it is keyed by the count).
- **The theme contract.**
  - The 44 colour names in `services/themes.py` are unchanged.
  - A converted surface takes its colours only from shadcn's variables or Blob's `--blob-*` extras, never a literal colour.
  - Structure tokens (`--elev-*`, `--frame-*`) may change.
- **Tests.**
  - Rewrite tests against the new markup; never delete one for being in the way.
  - Query by role and label, not by class.
  - A test that pinned a behaviour keeps pinning it.
  - Where a lazy module must be present at render, the test awaits its `preload()` first, as the overlay tests import `test/overlayChunk.ts`.
- **No CDN.** No font, icon or script comes from one.
- **Python is untouched.** For any pytest run, use `DATABASE_URL=postgres://blob:blob@localhost:5432/blob_shadcn_test REDIS_URL=redis://localhost:6379/14`.
- **Dev servers.** The controller runs every browser pass. Subagents do not sign in and do not start servers. The dev DB is `blob_shadcn_dev` with Redis db 13, through the worktree's `.env`.
- **Checking each task.**
  - Run `pnpm exec vitest run <the task's files>`, plus `pnpm typecheck` and `pnpm lint`, from `apps/web`.
  - A `| tail` pipe hides vitest's exit code, so capture `$?` before trusting a green run.
  - The full `pnpm check` runs in Task 6.
- **Merging.**
  - Only on the user's explicit go-ahead, and only after all four CI jobs pass on GitHub.
  - Merge by hand, as a squash, with `--match-head-commit`.
  - Never `--auto`, and never the app's auto-merge.

## Review Focus

1. **Escape with the phone Sheet open.** Someone opens the channel list on a phone, with a thread open behind it, and presses Escape. Expected: only the Sheet closes, focus is back on the trigger, the thread is still open, and the channel is not marked read. (Task 2 test.)
2. **A menu pressed before its module arrives.** On a slow first load, someone presses the account menu or a row's ··· before the chunk lands. Expected: the menu opens once it lands, without a second press. A placeholder that had focus hands focus to the real trigger. (Task 1 tests.)
3. **A menu item that opens a dialog.** Move to a section…, Leave, Rename section… or Delete section. Expected: the menu is gone, the dialog stays, one Escape closes the dialog only, and focus returns to the menu's trigger. (Task 4 tests.)
4. **The rail.** Someone folds the list. Expected: every row still has its accessible name; the active row is still marked (`aria-current`); mention badges still show; New direct message and All agents are still reachable; the fold survives a reload. (Task 2 tests.)
5. **Old URLs.** `/`, `/activity`, `/mentions`, `/files`, `/files?channel=<id>` and `/channels` open what they did on main. The highlighted row is right: Activity for `/activity`, Mentions for `/mentions`, Files for `/files`, Browse for `/channels`. (Task 2 tests.)

---

### Task 1: Menus that own their triggers, and a lazy Sheet

**Files:**
- Create: `apps/web/src/components/lazyDropdown.tsx`, `apps/web/src/components/lazyDropdown.test.tsx`, `apps/web/src/components/overlays/SidebarSheetImpl.tsx`
- Modify: `apps/web/src/lib/overlays.ts`, `apps/web/src/components/overlays/index.ts`, `apps/web/src/components/ui/sidebar.tsx`
- Test: `apps/web/src/components/lazyDropdown.test.tsx`, `apps/web/src/lib/overlays.test.ts` (create or extend), `features/console/ConsoleShell.test.tsx` (stays green)

**Interfaces:**
- Produces:
  - `lib/overlays.ts`: `export function preloadAlso(load: () => Promise<unknown>): void`.
    - A loader registered before `preloadOverlays()` has run starts in the same idle callback.
    - One registered after it has run starts at once, deferred past the current task.
    - Failures are swallowed, as `preloadOverlays` swallows its own.
  - `components/lazyDropdown.tsx`:
    ```ts
    export interface DropdownModuleProps { trigger: ReactElement; defaultOpen?: boolean }
    export function lazyDropdown<P extends DropdownModuleProps>(
      load: () => Promise<{ default: ComponentType<P> }>,
    ): ComponentType<Omit<P, 'defaultOpen'>> & { preload(): Promise<void> };
    ```
- The module's default export draws `<DropdownMenu defaultOpen={defaultOpen}>`, with `<DropdownMenuTrigger render={trigger} />` and its content.
- Until the module is loaded, the wrapper draws `trigger` cloned with `aria-haspopup="menu"`, `aria-expanded={false}` and an `onClick` that keeps the trigger's own and then asks for the module.
- Once the module is loaded, the wrapper draws it in the same render (memoised value, no Suspense flash), with `defaultOpen` true if the placeholder was pressed.
- The import is memoised with `memoiseImport` and registered with `preloadAlso`.
- `components/ui/sidebar.tsx`:
  - The mobile branch draws `SidebarSheetImpl` through `lazyOverlay`. It is mounted on first open and kept mounted after, so its exit animation plays.
  - `sheet.tsx` is no longer imported statically.
  - `SidebarMenuButton` has no `tooltip` prop and the file imports no tooltip.
  - Its `label`, `closeLabel` and `openerRef` behaviour is unchanged.

- [ ] **Step 1: Write the failing tests** in `components/lazyDropdown.test.tsx`, with a fake module whose import a test can hold and release:
  - `it('draws the trigger with aria-haspopup="menu" and aria-expanded="false" before the module arrives')`.
  - `it('opens the menu once the module arrives when the placeholder was pressed')`: press, release the import, then `getByRole('menu')` is present.
  - `it('draws the real trigger closed when the module arrives by preload')`: no menu, and the trigger's `aria-expanded` is `"false"`.
  - `it('keeps focus on the trigger when the module replaces a focused placeholder')`: `document.activeElement` is the real trigger.
  - `it('keeps the placeholder after a failed import and retries on the next press')`.
  - `it('starts a loader registered with preloadAlso when preloadOverlays runs')` in `lib/overlays.test.ts`.
  - `it('starts a loader registered after preloadOverlays ran')` in `lib/overlays.test.ts`.
  - In the Sidebar tests, at a mocked mobile width: `it('opens the mobile Sheet through the overlay chunk and hands focus back to its opener on Escape')`.
- [ ] **Step 2: Run them, expect failures:** `pnpm exec vitest run src/components/lazyDropdown.test.tsx src/lib/overlays.test.ts`.
- [ ] **Step 3: Implement** `preloadAlso`, `lazyDropdown`, `SidebarSheetImpl` and the barrel export, and the sidebar change.
  - If `ConsoleNav` used the `tooltip` prop, give those rows `data-tooltip` with the same text.
- [ ] **Step 4: Run the task's tests, `features/console/` tests, `pnpm typecheck`, `pnpm lint`.**
  - Then `pnpm build && node scripts/bundle-budget.mjs` must still pass, since the consoles now reach the Sheet through the overlay chunk.
- [ ] **Step 5: Commit** `feat(web): menus that own their triggers, and the sidebar's Sheet through the overlay chunk`.

### Task 2: The chat shell on SidebarProvider, and the channel list on shadcn's Sidebar

**Files:**
- Modify:
  - `apps/web/src/app/Workspace.tsx`;
  - `apps/web/src/features/channels/Sidebar.tsx`;
  - `apps/web/src/components/Icon.tsx` and `Icon.test.tsx`;
  - `apps/web/src/features/home/HomeView.tsx:305` and `apps/web/src/features/agentic/TasksView.tsx:92` (icon only);
  - `apps/web/src/styles/tokens.css` (`--elev-frame` dark, both blocks);
  - `styles/app/{shell,the-frame,narrow-viewports,calls,sidebar}.css`;
  - `styles/index.css`, `styles/tokenNames.test.ts`.
- Test: `features/channels/Sidebar.test.tsx`, `features/channels/Sidebar.sections.test.tsx` (rewritten), and a new `app/Workspace.shell.test.tsx`. If Workspace cannot be rendered in happy-dom at reasonable cost, test a `ShellFrame` component extracted from it.

**Interfaces:**
- Consumes: Task 1's `components/ui/sidebar.tsx`. ChannelMenu and the section menu stay the legacy `Menu` callers until Task 4, anchored to the row's `SidebarMenuItem`.
- Produces:
  - **The shell root.** The chat shell's root is `<SidebarProvider className="shell …" open={!sidebarCollapsed} onOpenChange={…}>`, which merges to a grid. It carries:
    - `style` with `--sidebar-width: 240px` and `--sidebar-width-icon: 4rem`;
    - `data-panel`, `data-panel-kind` and `data-in-call`.
  - **Removed state.** `sidebarDrawer`, `.drawer-scrim`, `data-sidebar` and `data-sidebar-collapsed` are gone. The Sheet and the provider's own state replace them.
  - **The TopBar for now.** TopBar is drawn by a small component inside the provider. It passes TopBar's existing `onToggleSidebar` and `onToggleCollapse` props from `useSidebar()`, so Task 3 can move them into TopBar.
  - **The Sidebar root.** `Sidebar.tsx` draws `<Sidebar variant="inset" collapsible="icon" label="Channel list" closeLabel="Close channel list" className="top-(--topbar-height) h-auto">`. Inside it is `<nav aria-label="Channel list">` holding `SidebarContent` and its groups.
  - **Nav rows, in this order.** Home, Activity (new), Mentions, Threads, Tasks, Decisions, Later, Files (new), Scheduled, Drafts.
    - Each is a `SidebarMenuButton` with `aria-current="page"` when active, plus a `SidebarMenuBadge` keyed by its count.
    - Activity is active for `/activity` and any `kind` other than `'mention'`. Mentions is active only for `kind === 'mention'`. Files is active for view `files`.
  - **Channel rows.** Each is a `SidebarMenuItem data-arriving` holding a `SidebarMenuButton` with `aria-current`, `data-unread` and `data-muted`, the mark, the name, the draft tag and the call mark. Beside it:
    - a `SidebarMenuBadge` for the mention count;
    - the live dot;
    - a `SidebarMenuAction showOnHover aria-label="Options for NAME"`.
  - **Groups.**
    - Each user section is a `SidebarGroup role="region" aria-label={name}`. Its toggle is `SidebarGroupLabel render={<button aria-expanded>}`.
    - Channels, Agents and Direct messages label with `SidebarGroupLabel render={<h2 />}`.
    - "All agents" and "New message" are `SidebarGroupAction`s.
  - **The rail.**
    - Group labels and actions hide.
    - Every row keeps its name (`aria-label` while folded) and Blob's `data-tooltip`.
    - The badge sits in the row's top-right corner and stays visible.
    - "New direct message" and "All agents" each become a row, as today's folded sidebar has them.
  - **Icons.** `Icon.tsx` gains `TaskIcon` (Lucide `ListTodo`) and `ActivityIcon` (Lucide `Bell`). Tasks uses `TaskIcon` in the sidebar, Home's "Open tasks" tile and the Tasks empty state.
  - **Phone navigation.** A row chosen on a phone calls `useSidebar().setOpenMobile(false)` as it navigates, as `ConsoleNav` does.

- [ ] **Step 1: Write the failing tests.**
  - `Sidebar.test.tsx`, rewritten by role and data attribute. Each behaviour it pinned stays:
    - the badge node is kept while its count holds and replaced when it changes;
    - `data-arriving` settles;
    - a private channel's mark;
    - a folded row is named;
    - a guest has no Browse and no New channel;
    - the huddle mark;
    - the live dot.
  - New, in the same file:
    - `it('links Activity and Files, and lights Activity for /activity, Mentions for /mentions, Files for /files')`;
    - `it('draws Tasks with the task icon')`. Lucide's class is `lucide-list-todo`. The same assertion goes in HomeView's and TasksView's tests, or in a test of their own if they have none.
    - `it('keeps New direct message and All agents reachable when folded')`;
    - `it('names the list as a navigation landmark')`.
  - `Sidebar.sections.test.tsx`, by role as today.
  - `Workspace.shell.test.tsx`, at a mocked mobile width:
    - `it('opens the channel list as a Sheet and closes it when a row is chosen')`;
    - `it('closes only the Sheet on Escape, leaving the thread open and the channel unread')`;
    - `it('folds to the rail and remembers it in blob.sidebar.collapsed')` (desktop width).
- [ ] **Step 2: Run them, expect failures.**
- [ ] **Step 3: Implement.**
  - **Escape.** The Workspace's `close` shortcut drops its sidebar branch. If Escape reaches it while the Sheet is open, it must do nothing: check how the window handler already leaves dialogs alone, and use the same test.
  - **The frame.**
    - `the-frame.css` keeps framing `.shell > .pane` and `.shell > .panel` on the new root, from 768px.
    - Its folded-sidebar rules key on the Sidebar's own `data-state`/`data-collapsible`.
    - The dark `--elev-frame` ring becomes `0 0 0 1px rgb(255 255 255 / 14%)`, with the drop shadow unchanged.
  - **`calls.css`.** Its `:not(.topbar):not(.sidebar):not(.drawer-scrim)` selectors name the new elements: `[data-slot=sidebar]` and the top bar's hook.
  - **Narrow rules.** The drawer rules in `narrow-viewports.css` go. The shell is one column below 768px.
  - **Centring.** Icons are centred on their labels by the menu button's own flex alignment; no nudges.
- [ ] **Step 4: Run the task's tests, `pnpm typecheck`, `pnpm lint`.**
- [ ] **Step 5: Commit** `feat(web): the channel list is shadcn's Sidebar — rail, Sheet, Activity and Files rows`.

### Task 3: The top bar, its account menu and the workspace switcher

**Files:**
- Modify: `apps/web/src/features/shell/TopBar.tsx`, `features/shell/WorkspaceSwitcher.tsx`, `features/console/ConsoleShell.tsx` (drop the TopBar island)
- Create: `features/shell/AccountMenu.tsx`, `features/shell/WorkspaceMenu.tsx` (lazyDropdown modules)
- Delete or trim, rule by rule: `styles/app/top-bar.css`, `view-switching-in-the-bar.css`, `feedback-in-the-corner.css`, and the switcher, `.user-menu-*` and top-bar rules in `workspace-switcher.css`, `narrow-viewports.css`, `overlay-motion.css`, `dialogs-settings.css`, `channel-menu-and-details.css`
- Test: `TopBar.minimal.test.tsx`, `TopBar.feedback.test.tsx`, `TopBar.test.ts` (rewritten); new `AccountMenu.test.tsx`, `WorkspaceSwitcher.test.tsx`

**Interfaces:**
- Consumes: `lazyDropdown` (Task 1), `useSidebar()` (Task 2's provider), `ITEMS` (`menu.ts`, unchanged).
- Produces:
  - **The tabs are gone.** The minimal bar has no Messages, Activity, Files or Channels button.
  - **The list trigger.** It sits at the bar's left in the chat shell. It is `Button variant="ghost" size="icon-sm"` with `PanelLeftIcon`:
    - Below 768px: `aria-label` "Open channel list" / "Close channel list", `aria-expanded={openMobile}`.
    - From 768px: "Hide channel list" / "Show channel list", `aria-expanded={open}`.
    - The consoles' bar has none.
  - **The workspace mark** is a plain `aria-hidden` mark in both bars.
  - **Search.** One button, centred, `w-full max-w-md`, icon plus a visible "Search" label at every width; at 400px it shrinks before anything overflows. It calls `onSearch ?? navigate('/search')`. Invite, for admins, is icon-only below 768px, with `aria-label="Invite people"`.
  - **The consoles' bar** keeps its Messages and Search buttons and its Feedback button, as shadcn `Button`s with labels hidden below 768px.
  - **The account menu.** Its trigger is a ghost `Button` holding the avatar, the presence dot, the display name (hidden below 768px), the release dot and a chevron. Its accessible name contains the display name.
    - The content starts with a `DropdownMenuLabel` (name, email), then the `ITEMS` that pass `adminOnly` / `ownerOnly` / `instanceOnly` as `DropdownMenuItem`s.
    - What's new carries its dot, labelled "New since you last looked".
    - Feedback runs `onFeedback` only after the menu has closed (`onOpenChangeComplete`), so the snapshot sees the page.
    - The menu closes when the path changes.
  - **The workspace switcher.** With two or more workspaces, it is a DropdownMenu: a "Your workspaces" label, then one item per workspace, the current one disabled and badged "Current".
    - Choosing one calls `api.workspaces.switch(id)` then `window.location.assign('/')`, as today.
    - With fewer than two, it is the plain name.

- [ ] **Step 1: Write the failing tests.**
  - `TopBar.minimal.test.tsx`:
    - `it('draws no view tabs')`: no button named Messages, Activity, Files or Channels in the minimal bar.
    - The Search and Invite assertions, kept.
    - `it('names the list trigger by width and state')`, at mobile and desktop widths.
    - The consoles' bar, kept: it has Messages and Search, and no list trigger.
  - `AccountMenu.test.tsx`:
    - `it('lists the items the viewer may open')`, for member, admin and instance admin.
    - `it('runs Feedback after the menu has closed')`.
    - `it('marks What's new while a release is unseen')`.
  - `TopBar.feedback.test.tsx`: the same three behaviours.
  - `WorkspaceSwitcher.test.tsx`:
    - `it('is a plain name with one workspace')`;
    - `it('lists workspaces with the current one disabled')`;
    - `it('switches and reloads')`.
- [ ] **Step 2: Run them, expect failures.**
- [ ] **Step 3: Implement,** then delete the rules whose last user is gone.
- [ ] **Step 4: Run the task's tests, `features/console/` tests, `pnpm typecheck`, `pnpm lint`.**
- [ ] **Step 5: Commit** `feat(web): the top bar without tabs — a list trigger, Search with room, real account and workspace menus`.

### Task 4: ChannelMenu and the section menu as DropdownMenus

**Files:**
- Modify: `apps/web/src/features/channels/ChannelMenu.tsx` (becomes a lazyDropdown module), `features/channels/Sidebar.tsx` (row and section triggers), `features/messages/ChannelView.tsx` (its trigger only)
- Create: `features/channels/SectionMenu.tsx` (a lazyDropdown module)
- Delete or trim: `.channel-kebab`, `.section-kebab` and `.user-menu-item` legacy rules, where the last user is gone
- Test: `ChannelMenu.test.tsx`, `Sidebar.sections.test.tsx` (rewritten); new cases below

**Interfaces:**
- Consumes: `lazyDropdown` (Task 1), the rows' `SidebarMenuAction` and the sections' `SidebarGroupAction` (Task 2).
- Produces:
  - **ChannelMenu's content,** in this order:
    - a `DropdownMenuLabel` "Notifications" and a `DropdownMenuRadioGroup` of "Every message", "Mentions" and "Nothing" (`role="menuitemradio"`, `aria-checked`), each with its hint as `title`; hidden for DMs;
    - a separator, then Star / Remove from starred, and Move to a section… / Move to another section…;
    - Channel details (not for DMs), then the optional runs item;
    - a separator, then Leave channel (`variant="destructive"`, not for DMs) and Archive channel (destructive; admins, not archived).
    - An error shows as `<p role="alert">` inside the content, not as an item.
  - **Its dialogs.** `MoveToSectionDialog` and the confirms live in the module outside `DropdownMenu`, so choosing an item closes the menu and leaves the dialog open. When the dialog closes, focus returns to the menu's trigger.
  - **SectionMenu.** Rename section… and Delete section (destructive), with the same dialog rule.
  - **What is left of `components/Menu.tsx`.** Its callers are only MessageMenu and SchedulePicker (phase 5).

- [ ] **Step 1: Write the failing tests.**
  - `ChannelMenu.test.tsx`, by role: the radio group's state, starring, Leave's confirm, Archive only for admins, and a DM's smaller menu.
  - `it('closes the menu and keeps the dialog when Move to a section… is chosen')`.
  - `it('closes only the dialog on Escape and returns focus to the trigger')`.
  - `it('moves the highlight with ArrowDown and closes on Escape')`.
  - `Sidebar.sections.test.tsx`: rename and delete through the section menu.
- [ ] **Step 2: Run them, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the task's tests, the messages tests that render ChannelView's header, `pnpm typecheck`, `pnpm lint`.**
- [ ] **Step 5: Commit** `feat(web): the channel and section menus are DropdownMenus with their own triggers`.

### Task 5: ⌘K as Command, in a chunk of its own

**Files:**
- Modify: `apps/web/package.json` and the lockfile (`cmdk@1.1.1`), `features/palette/CommandPalette.tsx`, `app/Workspace.tsx` (the three mount sites)
- Create: `components/ui/command.tsx`. Use `pnpm exec shadcn add command`, then restore `button.tsx`, `input.tsx` and `input-group.tsx`, which the CLI overwrites. Phase 3's touch targets live there.
- Delete: `styles/app/command-palette.css`, and the `.palette-scope` coarse-pointer rule
- Test: `CommandPalette.a11y.test.tsx` (intent kept), `CommandPalette.search.test.tsx` (rewritten off `.palette-item-*`)

**Interfaces:**
- Consumes: `preloadAlso` (Task 1), `memoiseImport`, `components/Dialog.tsx` (unchanged).
- Produces:
  - **Loading.** `CommandPalette.tsx` default-exports the palette. Workspace draws it through `lazy()` on a memoised import registered with `preloadAlso`, with `<Suspense fallback={null}>`.
  - **The body.** Inside `Dialog` (same labels, "Jump to" / "Message someone") is `<Command shouldFilter={false} loop>` holding:
    - a `CommandInput`;
    - the scope chip (a `Button` named "…change what is searched…", as the test asks);
    - a `CommandList`, then one `CommandGroup` per section with its heading;
    - `CommandItem value={item.id}`, whose `onSelect` closes and then runs, as `choose` does today;
    - a `CommandEmpty`, and the footer's key hints.
  - **Data and keys.** Ranking, fetching, debouncing and `only="people"` are unchanged. Tab and Shift+Tab step the scope.
  - **The combobox.** It reports `aria-expanded="false"` while there are no options. If cmdk hard-codes `true`, override the prop.
  - **Test hooks.** Rows carry `data-part="mark" | "label" | "kind"` for the tests in place of the classes.

- [ ] **Step 1: Rewrite the tests first.**
  - The a11y test's four assertions, unchanged in meaning.
  - The search test off classes, every case kept.
  - `it('steps the scope with Tab and back with Shift+Tab')`.
  - `it('loads after first paint and is not in the entry chunk')`, as a build check. It runs in Task 6's measure and is noted in the ledger.
- [ ] **Step 2: Run them, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the palette tests, `pnpm typecheck`, `pnpm lint`.** Then run `pnpm build`. Confirm that no `cmdk` and no `CommandPalette` code is in a chunk `index.html` names, and note the palette chunk's gzipped size.
- [ ] **Step 5: Commit** `feat(web): ⌘K is shadcn's Command, loaded after first paint`.

### Task 6: Sweep, budget the stylesheet, record

**Files:**
- Modify: `scripts/bundle-budget.mjs`, `styles/**` (the sweep), `styles/legacyIsland.test.ts` (the TopBar island is gone), `.torsor/architecture/decisions/0043-blob-takes-shadcns-look.md` (a "Phase 4: the shell (2026-11-19)" addendum), `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md` (phase 4 marked done)

**Interfaces:**
- Produces:
  - `bundle-budget.mjs` also measures every stylesheet `index.html` links, gzipped, against `CSS_BUDGET_KB`, and fails past it.
    - `CSS_BUDGET_KB` is the measure rounded up, plus 1 KB.
    - The measure must not exceed main's **46.2 KB** (at e6414252). If it does, the consoles' own utilities move to a stylesheet loaded with their chunks in this task, and the measure is taken again.
  - `BUDGET_KB` is set to the JavaScript measure rounded up, plus 1 KB.

- [ ] **Step 1: Sweep.**
  - Delete every legacy rule and file whose classes no file under `apps/web/src` renders.
  - List the deleted files and line counts in the commit message.
  - Keep the phase 5–6 classes named in the Global Constraints.
- [ ] **Step 2: Budget.** Add the stylesheet measure, build, measure both, and set both budgets.
- [ ] **Step 3: Record.** Write the ADR addendum, in the form of phase 3's. It covers:
  - the user's navigation decision, with its date and words;
  - every call above, as it turned out;
  - the budget numbers: JS first load, stylesheet, the palette chunk;
  - the rules for phases 5–6 this phase settled.
  Then mark phase 4 done in the spec.
- [ ] **Step 4: The gate.**
  - `pnpm check` (pytest with the test DB above);
  - `uv run alembic check` from `apps/api`;
  - `torsor guard --strict --severity error $(git ls-files '*.py')`;
  - `pnpm build && node scripts/bundle-budget.mjs`.
  All green.
- [ ] **Step 5: Commit** `chore(web): phase 4 sweep — the shell's legacy CSS is gone, and the stylesheet has a budget`.

## After the tasks (the controller's, not a subagent's)

1. **Browser pass.** On the dev server, signed in as the seed's owner and a guest. At 400 and 1440px, light and dark:
   - every page in `e2e/contract.e2e.ts` plus `/tasks`, `/mentions` and `/files?channel=<general>`;
   - axe (wcag2a/aa, 2.1, 2.2);
   - no sideways scroll at 400.
   The acceptance checks, measured:
   - the list trigger is visible and named at 400;
   - the Search label is not clipped and no top-bar child overflows at 400;
   - every sidebar icon's centre is within 0.5px of its label's;
   - the dark frame's edge is at least 1.3:1 against the ground;
   - Tasks shows `lucide-list-todo` in its three places.
   Screenshots go to the ledger's `screens/`.
2. **Behaviours in Chromium, Firefox and WebKit:**
   - the Sheet: opens, Escape closes it, focus returns, choosing a row closes it;
   - each of the four menus: opens by click and by keyboard, the arrows move, Escape closes, focus returns;
   - a menu item's dialog;
   - ⌘K and ⌘⇧K: Tab steps the scope, Enter navigates;
   - the rail.
3. **Production-bundle smoke,** with the API serving `dist` and its real CSP, in all three engines:
   - `index.html` names no console, overlay, palette or menu-module chunk;
   - a chat page loads with no CSP violation and no console error;
   - a menu pressed before its module arrives opens, with `page.route` delaying the chunk;
   - the Sheet and a confirm each take one Escape.
4. **Final review** (most capable model) of the whole branch, then one fix wave.
5. **The PR.** Open it with the numbers and the screenshots; do not merge it.
