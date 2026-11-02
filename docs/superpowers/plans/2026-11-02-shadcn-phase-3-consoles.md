# shadcn Phase 3 — The Three Consoles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/settings`, `/admin` and `/server` are drawn with shadcn components (preset b0) and Tailwind utilities. That covers the console frame and nav, every section under `features/admin/sections/` and `features/settings/`, and the theme editor. The console's legacy CSS is deleted wherever the consoles were its last user. The consoles stay out of the first load. Shippable as one PR.

**Architecture:** The consoles are already three lazy chunks (`app/Workspace.tsx`), so shadcn's form controls, Sidebar, Sheet and Tabs land there and never reach the first load. Task 1 builds the frame and a small console kit:
- `ConsoleShell` on shadcn `Sidebar`/`SidebarInset`, with a Sheet below 768px;
- `ConsoleNav` as a `SidebarMenu`;
- `Card` on shadcn `Card`;
- `CopyField` on `InputGroup`;
- the 44px coarse-pointer minimum baked into the ui components.

Until the last section is converted, the page body is a legacy island (`data-legacy`), so unconverted sections keep the browser defaults `styles/app/base.css` hands back. Tasks 2–6 convert the sections by console group, each deleting the legacy rules it was the last user of. Task 7 closes the island and sweeps the rest.

**Tech Stack:** shadcn CLI 4.23 (`pnpm exec shadcn add …`, style base-nova), `@base-ui/react` 1.9, `lucide-react`, `cn` in build mode (`src/lib/cn-tables.ts`), Tailwind v4.3, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md` (phase 3: "The three consoles … including the theme editor. Stays out of the main chunk."); ADR 0043.

**Calls made without the user (recorded in ADR 0043's phase 3 addendum, Task 7):**
- **The console nav is shadcn's Sidebar.** Narrow screens get its Sheet, which traps focus, closes on Escape and returns focus; today's drawer does none of that. The Sidebar's two global side effects are stripped from the copied component: the `sidebar_state` cookie, sent with every request for no reason, and the ⌘B shortcut, which Slack users don't expect. Phase 4 reuses this component for the channel list.
- **The narrow breakpoint moves from 900px to 768px.** That is shadcn's, and it is where the chat's Meadow frame already starts (769px). Between 768 and 900 the nav now stays open beside the page instead of folding into a drawer.
- **Selects stay native** (`native-select`), not Base UI's `Select`. A native select keeps the phone's own picker and the platform's keys. It brings no popup code into the console chunk, and the ~30 `<select>` callers and their `fireEvent.change` tests keep their semantics.
- **The health and usage charts stay hand-drawn SVG**, coloured from `--chart-1..5`. shadcn's `chart` brings recharts, and nothing here needs it.
- **`WhatsNewView` (`features/settings/WhatsNewView.tsx`) is not a console page.** It renders as a pane in the chat shell, so it stays for phase 6 ("what's new").

## Global Constraints

- **Workspace.** Work in `/Users/magnetoid/c/blob-shadcn-3`, branch `shadcn-3-consoles`, cut from `origin/main` at e9a5a719. Never touch `/Users/magnetoid/c/blob` or `/Users/magnetoid/c/blob-shadcn`.
- **First load.** At most 260 KB gzipped. Nothing under `features/{console,admin,settings,server}/` and no ui component only they use may be imported from first-load code. `node scripts/bundle-budget.mjs` stays green, including its `OVERLAY_SDK` guard. Raise `BUDGET_KB` only in Task 7, only to what was measured, in the commit that says why. `cn-tables.ts` is first-load and grows with the class groups the consoles use.
- **Callers outside the consoles are not edited.** The exceptions:
  - `components/ui/*` (added or adjusted shadcn files);
  - `styles/index.css` (`@source` lines);
  - `styles/tokenNames.test.ts` (allow-list);
  - legacy CSS under `styles/app/` (deleting rules whose last user was converted);
  - `e2e/contract.e2e.ts` (Task 3's locator);
  - `scripts/bundle-budget.mjs` (Task 7).
- **Legacy CSS.** Delete a rule only when no file under `apps/web/src` still renders its class. The check is `node <scratchpad>/p3/cssmap.mjs` (in the ledger folder) or a grep. Classes shared with `features/agentic/` (`admin-row*`, `console-list*`, `admin-secret-card`, `admin-command-block`, `role-pill`, `pref-*`, `chip-row`, `section-label`), and `console-card` (used by `components/EmptyState.tsx`), stay until their last user goes.
- **Tailwind sources.** Each converted file or directory gets an `@source` line in `styles/index.css`, and the allow-list in `styles/tokenNames.test.ts` grows to match. Never add a directory that still holds unconverted markup. `features/admin/sections/` is added file by file until Task 6 finishes it.
- **Legacy islands.**
  - Legacy markup drawn inside any `data-slot` element is wrapped in `data-legacy`. That covers `TopBar` inside the Sidebar's provider, `features/agentic/DesktopAgentSetup.tsx` inside My agents, and `features/agentic/AgentTerminal.tsx` inside the agent deployment page.
  - Converted markup is drawn inside a shadcn component, or under the console body's own `data-slot="console-body"` once Task 7 closes the island.
  - `styles/legacyIsland.test.ts` stays green.
- **Behaviours that must survive** (the spec's anti-goals):
  - one Escape closes one layer;
  - focus returns to the opener;
  - 44px minimum targets under `pointer: coarse`;
  - axe passes on the eight console pages in `e2e/contract.e2e.ts`;
  - muted text at 4.5:1 or better in all twelve presets;
  - a page's entrance plays once per section and not when only the detail id changes, and under reduced motion it fades without moving.
- **The theme contract.**
  - `services/themes.py`'s colour names are unchanged.
  - The theme editor reads and writes exactly those names.
  - `lib/theme.ts` still writes a theme as inline properties on `<html>`.
  - A converted surface takes its colours only from shadcn's variables or Blob's `--blob-*` extras, never a literal colour, so a workspace theme repaints it.
- **Tests.** Rewritten against the new markup, never deleted for being in the way. Query by role and label (`getByRole('switch', { name, checked })`), not by class. A test that pinned a behaviour keeps pinning it.
- **No CDN.** No font, icon or script comes from a CDN.
- **Python is untouched.** For any pytest run, use `DATABASE_URL=postgres://blob:blob@localhost:5432/blob_shadcn_test REDIS_URL=redis://localhost:6379/14`.
- **Dev servers.** Start one only if :3000 and :5173 are free. Use the dev DB `blob_shadcn_dev` with Redis db 13, and never migrate the shared `blob` DB. Subagents do not sign in; the controller runs every browser pass.
- **Checking each task.** `pnpm exec vitest run <the task's files>` plus `pnpm typecheck` and `pnpm lint` from `apps/web`. A `| tail` pipe hides vitest's exit code, so capture `$?` before trusting green. The full `pnpm check` runs in Task 7.
- **Merging.** Only on the user's explicit go-ahead, after all four CI jobs pass on GitHub, by hand, squashed, with `--match-head-commit`. Never `--auto`, and never the app's auto-merge.

## The console kit (decided here, used by Tasks 2–6)

| Legacy | Becomes |
|---|---|
| `.btn-primary` / `.btn` / `.btn-ghost` / danger button | `Button` `default` / `outline` / `ghost` / `destructive` |
| `.icon-btn` | `Button size="icon"` (or `icon-sm`) with an `aria-label` |
| `.input`, `.console-input` | `Input` |
| `<textarea class="input">` | `Textarea` |
| `<select class="input">` | `NativeSelect` + `NativeSelectOption` |
| `.toggle` (`<button aria-pressed>`) | `Switch` (`role="switch"`, `aria-checked`), same `aria-label` |
| `type="checkbox"` | `Checkbox` with a `Label` |
| `.pref-row` (label, hint, control) | `Field orientation="horizontal"` → `FieldContent` (`FieldLabel`, `FieldDescription`) + the control |
| a labelled form field, `.field-label`, `.error-text` under a field | `Field` → `FieldLabel`, the control, `FieldDescription`, `FieldError` |
| `.admin-row`, `.console-list-item` | `Item` → `ItemMedia?`, `ItemContent` (`ItemTitle`, `ItemDescription`), `ItemActions`; a list of them in `ItemGroup` with `ItemSeparator` |
| `.role-pill`, `.console-nav-badge`, status pills | `Badge` (`secondary` / `outline` / `destructive`) |
| `<table>` | `Table` family |
| `role="tab"` strips | `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` |
| `.chip-row` filters | `ToggleGroup` when it is a single choice, `Button size="sm" variant="outline"` with `aria-pressed` when not |
| `.console-copy` | `CopyField` (Task 1) |
| usage and storage bars | `Progress` |
| inline error strip | the frame's error slot (Task 1). Inside a card: `Alert variant="destructive"` |
| `.console-notice`, `.muted` | `CardNotice`; `text-muted-foreground` |

Spacing inside a page uses `flex flex-col gap-6` between cards and the Card component's own padding, not margins.

## Review Focus

1. **The section menu at 400px.** Someone opens the nav Sheet, picks a section, and expects the Sheet to close, the new page to show, and focus to be inside the page. Escape on an open Sheet should close only it and return focus to the toggle. (Task 1 tests.)
2. **A custom theme on the console.** Someone whose workspace runs Linen, Harbour or Midnight opens `/admin`. The nav, cards, inputs and switches should all wear that theme, and muted text should stay readable. (Task 1 test: no literal colour in converted console files. Task 7 visual pass on Linen and Midnight.)
3. **Keyboard only.** Someone tabs through Notifications. Each Switch should be reachable, show a visible focus ring, toggle on Space, and save as it did before. (Task 2 test.)
4. **Long values.** An app with a 60-character name, a long email, a webhook URL or a JSON payload should truncate or wrap inside its row or table cell. No console page should scroll sideways at 400px. (Task 7 sweep over every console page at 400px.)
5. **A confirm opened from a converted section.** Pressing Escape in a confirm opened from Retention or SSO should close only the confirm and put focus back on the button that opened it. (Task 6 test.)

---

### Task 1: The console frame and kit

**Files:**
- Create via `pnpm exec shadcn add card field input textarea label native-select switch checkbox badge table tabs item separator input-group sidebar sheet tooltip progress alert toggle-group` from `apps/web`. Keep the existing `button.tsx` and `skeleton.tsx`. The CLI may offer to overwrite them, and the answer is no.
- Create: `apps/web/src/features/console/CopyField.tsx`, `CopyField.test.tsx`, `apps/web/src/components/ui/touchTargets.test.ts`.
- Modify:
  - `components/ui/sidebar.tsx`: no cookie, no ⌘B, breakpoint 768px.
  - `components/ui/button.tsx`, `input.tsx`, `native-select.tsx`, `tabs.tsx`, `switch.tsx`, `checkbox.tsx`, `sidebar.tsx`, `toggle.tsx`: touch targets.
  - `features/console/ConsoleShell.tsx`, `ConsoleNav.tsx`, `Card.tsx` and their tests.
  - `features/admin/AdminConsole.tsx`, `features/settings/SettingsConsole.tsx`, `features/server/ServerConsole.tsx`: the toggle prop goes.
  - `styles/index.css`, `styles/tokenNames.test.ts`.
  - The legacy rules for the frame and nav: `admin-console-the-page-frame.css`, `the-console-nav.css`, `the-console-page.css`, and the `.admin-nav-*` rules in `the-console-page-cards.css` and `the-agents-console.css`.

**Interfaces:**
- Produces:
  - `ConsoleShell` with the same props minus `toggle`. It renders `SidebarProvider` → `TopBar` (in a `data-legacy` wrapper) → `Sidebar collapsible="offcanvas" variant="inset"` holding `ConsoleNav` → `SidebarInset` as `<main className="admin-main">`. Keep the class: e2e and axe wait for `.admin-main`.
  - The inset uses Blob's frame tokens (`--frame-gap`, `--frame-radius`, `--elev-frame`), so it sits where the chat's pane sits.
  - Inside it, the header carries `SidebarTrigger` (aria-label "Open the section menu", shown below 768px only), `h1` and description. The error slot is `<p role="alert">` in `text-destructive`.
  - The body is `<div data-legacy key={section}>` until Task 7. It enters with a fade plus a `translateY(var(--motion-slide))`, over `--dur-open` and `--blob-ease-out`.
  - `ConsoleNav` keeps its props, except `onNavigate`, which is now handled inside it with `useSidebar().setOpenMobile(false)`. It renders:
    - `SidebarHeader` (back button, title, subtitle, filter `Input` with the search icon);
    - `SidebarContent` → per group a `SidebarGroup`, with a `SidebarGroupLabel` only when the group has a label → `SidebarMenu` → `SidebarMenuButton isActive aria-current` per row;
    - `SidebarMenuBadge`s for restricted and new rows.
  - `Card`, `CardHeading`, `CardNotice`: same exports and props, drawn on shadcn `Card` / `CardHeader` / `CardTitle` (an `h2`, per the existing tests) / `CardDescription` / `CardAction` / `CardContent` / `CardFooter`. `CardHeading` keeps its h2/h3 rule. `CardNotice` is a `<p>` in `text-sm text-muted-foreground`.
  - `CopyField({ value, label, copiedNote?: string = 'Copied' }): JSX.Element` is a read-only `InputGroup` holding the value, with an `InputGroupButton` "Copy" that writes to `navigator.clipboard` and shows the note for 2 s in a `role="status"` span.

- [ ] **Step 1: Write the failing tests**
  - In `ConsoleShell.test.tsx`, keep the three frame tests, rewritten for the new markup, and add:
    - `it('opens the section menu as a sheet below 768px and closes it when a section is chosen')`. Mock `matchMedia` to narrow, click the trigger, expect `getByRole('dialog')`, click a nav row, expect no dialog.
    - `it('closes the sheet on Escape and puts focus back on the trigger')`.
    - `it('keeps the top bar a legacy island')`: the top bar's `header.topbar` has an ancestor with `data-legacy`.
    - `it('plays the page entrance once per section')`: the body element is replaced when the section changes and kept when only `detailId` changes.
  - In `ConsoleNav.test.tsx`, keep every existing test, querying rows as `getByRole('button', { name })` with `aria-current`. Replace "closes the drawer when a section is chosen" with the Sheet version above.
  - In `touchTargets.test.ts`, `it('gives every control a 44px floor under a coarse pointer')` reads the source of `button.tsx`, `input.tsx`, `native-select.tsx`, `tabs.tsx`, `switch.tsx`, `checkbox.tsx`, `toggle.tsx` and `sidebar.tsx` (`SidebarMenuButton`), and expects `pointer-coarse:min-h-11` in each. Icon sizes also get `pointer-coarse:min-w-11`. For Switch and Checkbox, the 44px goes on an invisible hit area (`after:` pseudo), not on the drawn control.
  - In `CopyField.test.tsx`:
    - `it('copies the value and says so')`;
    - `it('labels the field for a screen reader')`.
  - `it('paints the console from theme variables only')` in a new `features/console/colours.test.ts` greps every `.tsx` under `features/{console,admin,settings,server}` for literal colours: `#[0-9a-f]{3,8}\b`, `rgb(`, `oklch(`, and Tailwind palette names like `bg-red-500`. The allow-list is empty.
- [ ] **Step 2: Run them and see them fail.** `pnpm exec vitest run src/features/console src/components/ui`.
- [ ] **Step 3: Add the components and adjust `sidebar.tsx`.** Drop the cookie write and the keyboard-shortcut effect, with a comment saying why. Set `MOBILE_BREAKPOINT` in the generated `hooks/use-mobile.ts` to 768. Bake the touch targets into the ui files.
- [ ] **Step 4: Rewrite `ConsoleShell`, `ConsoleNav`, `Card` and `CopyField`.** Delete the legacy rules that only they used. Add `@source` lines for `features/console/` and the three console roots, and update `tokenNames.test.ts`.
- [ ] **Step 5: Run Task 1's tests, `pnpm typecheck` and `pnpm lint`.** Expect PASS.
- [ ] **Step 6: Commit.** `feat(console): the console frame on shadcn's Sidebar, and the console kit`.

### Task 2: Settings — Profile & preferences, Sign-in & security, My agents, Assistants

**Files:**
- Modify: `features/settings/ProfileCard.tsx`, `PreferencesCard.tsx` (the palette picker), `NotificationsCard.tsx`, `SecuritySection.tsx`, `AssistantsSection.tsx`, `MyAgentsSection.tsx`, `YouSection.tsx`, `features/console/ConnectedAppRow.tsx`, and their tests.
- Legacy CSS: `choosing-a-palette.css`, `profile.css`, and the settings-only rules in `dialogs-settings.css` and `the-console-page-cards.css`.
- Not touched: `WhatsNewView.tsx`.

**Interfaces:**
- Consumes: Task 1's kit (`Card`, `CardHeading`, `CardNotice`, `CopyField`, and the ui components in the kit table).

- [ ] **Step 1: Update the tests to the kit's roles.** Add `it('toggles a notification switch from the keyboard and saves it')` to `NotificationsCard.test.tsx`: focus the "Quiet hours" switch, press Space, expect `aria-checked="true"` and one save call with `{ dnd: { enabled: true } }`.
- [ ] **Step 2: Run them and see them fail.** `pnpm exec vitest run src/features/settings src/features/console/ConnectedAppRow`.
- [ ] **Step 3: Convert the files.**
  - The palette picker keeps its radio semantics: `role="radiogroup"`, arrow keys move between presets. Each swatch is drawn from the preset's own values, so it is not a literal colour in source.
  - `DesktopAgentSetup` is wrapped in `data-legacy`.
  - Add `@source` lines for each converted file.
  - Delete the rules this task was last to use.
- [ ] **Step 4: Run the tests, typecheck and lint.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(settings): your console on shadcn`.

### Task 3: Workspace — General, Appearance (theme editor), People, Groups, Invitations, Channels, Emoji, Calls, Feedback

**Files:**
- Modify, with tests: `features/admin/sections/GeneralSection.tsx`, `ThemesSection.tsx`, `PeopleSection.tsx`, `PeopleHub.tsx`, `GroupsSection.tsx`, `InvitationsSection.tsx`, `ChannelsSection.tsx`, `EmojiSection.tsx`, `calls/*`, `FeedbackSection.tsx`.
- Modify: `e2e/contract.e2e.ts:67`.
- Legacy CSS: `calls-the-admin-settings-page.css`, `feedback-tickets.css`, and the rules these sections were last to use.

**Interfaces:**
- Consumes: Task 1's kit.

- [ ] **Step 1: Update the tests to the kit's roles, and add these:**
  - `ThemesSection.test.tsx`: `it('saves a theme under the same colour names it loaded')`. Load a theme with `--background`, `--primary` and `--sidebar`, change `--primary` in the editor, save, and expect the request body's keys to equal what was loaded.
  - `CallsSection.test.tsx`: `it('moves between Huddles and Meetups with the arrow keys and keeps the URL in step')`. `/admin/huddles` and `/admin/meetups` stay the two tabs.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Convert the files.**
  - The theme editor groups its fields by `TOKEN_GROUPS` exactly as before.
  - Invitations shows each link in a `CopyField` labelled "Invitation link".
  - In e2e, `.console-copy .ellipsis` becomes `getByRole('textbox', { name: 'Invitation link' }).first().inputValue()`.
  - Add `@source` lines and delete the rules this task was last to use.
- [ ] **Step 4: Run the tests, typecheck and lint.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(admin): the Workspace pages on shadcn, theme editor included`.

### Task 4: Apps & agents — the Apps page and one app's settings

**Files:**
- Modify, with tests: `features/admin/sections/AppsSection.tsx`, `AppSettings.tsx`, and `apps/*`: `PluginCard`, `InstallAppForm`, `ConnectAgentForm`, `AgentConfig`, `AgentDeployment`, `AgentFollows`, `BudgetRow`, `RunLog`.
- Legacy CSS: `an-agents-configuration.css`, `hosted-agent-deployment.css`, `deploying-an-agent-from-a-repository.css`, and the parts of `the-agents-console.css` these were last to use.

**Interfaces:**
- Consumes: Task 1's kit.

- [ ] **Step 1: Update the tests to the kit's roles.** `RunLog` tests query `.run-log-detail` today; move them to the row's accessible name and `aria-expanded`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Convert the files.** `AgentTerminal` is wrapped in `data-legacy`. The app's secret and its install command use `CopyField`. Add `@source` lines and delete the rules this task was last to use.
- [ ] **Step 4: Run the tests, typecheck and lint.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(admin): Apps & agents on shadcn`.

### Task 5: Apps & agents — Janus, MCP servers, Usage, Approvals, Webhooks, Deliveries, Assistants

**Files:**
- Modify, with tests: `features/admin/sections/janus/*`, `McpServersSection.tsx`, `UsageSection.tsx`, `features/console/UsageTable.tsx`, `ApprovalsSection.tsx`, `WebhooksSection.tsx`, `DeliveriesSection.tsx`, `AssistantsAdminSection.tsx`.
- Legacy CSS: `the-janus-page-server-half.css`, `mcp-servers.css`, `usage.css`, and what remains of `the-agents-console.css` that only these used.

**Interfaces:**
- Consumes: Task 1's kit.

- [ ] **Step 1: Update the tests to the kit's roles.** `RawConfig` keeps refusing a save that still holds the redaction placeholder; its test stays as it is apart from queries.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Convert the files.**
  - The usage chart bars are `Progress` or SVG on `--chart-*`.
  - The usage table is `Table`, with its header sticky, as today.
  - Add `@source` lines and delete the rules this task was last to use.
- [ ] **Step 4: Run the tests, typecheck and lint.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(admin): Janus, MCP servers, usage and delivery pages on shadcn`.

### Task 6: Data & security, and the server's pages

**Files:**
- Modify, with tests: `features/console/ExportsCard.tsx`, `features/admin/sections/ImportSection.tsx`, `RetentionSection.tsx`, `SecuritySection.tsx`, `AuditSection.tsx`, `health/*`, `StorageSection.tsx`, `AccountsSection.tsx`, `SsoSection.tsx`, `AppPolicySection.tsx`, `LogsSection.tsx`.
- Legacy CSS: `server-logs.css`, `which-build-this-is.css`, `admin-import.css` (console rules only), and the rest these were last to use.
- When this task is done, `features/admin/sections/` holds no legacy markup. Replace its per-file `@source` lines with one `@source "../features/admin"`.

**Interfaces:**
- Consumes: Task 1's kit.

- [ ] **Step 1: Update the tests to the kit's roles.** Add `it('closes only the confirm on Escape and returns focus to the button that opened it')` to `RetentionSection.test.tsx` and `SsoSection.test.tsx` (Review Focus 5).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Convert the files.**
  - The health trend chart keeps its SVG, coloured from `--chart-*`.
  - The logs stay monospace, in a scroll area with no horizontal page scroll.
  - Add `@source` and delete the rules this task was last to use.
- [ ] **Step 4: Run the tests, typecheck and lint.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(admin): data, security and the server's pages on shadcn`.

### Task 7: Close the island, sweep, measure, record

**Files:**
- Modify: `features/console/ConsoleShell.tsx` (the body becomes `data-slot="console-body"` and loses `data-legacy`), `styles/index.css`, every legacy CSS file left with rules no file renders, `scripts/bundle-budget.mjs` (`BUDGET_KB` to measured + 1), `.torsor/architecture/decisions/0043-blob-takes-shadcns-look.md` (phase 3 addendum: the five calls above, the island, the touch targets), `CLAUDE.md` (the console sentences in "The three consoles" and the frame bullet that name `.admin-main`'s legacy framing), the spec's phase 4 line (the Sidebar exists; the channel list reuses it).

- [ ] **Step 1: Close the island.** Run the class map and delete every rule no file renders. `styles/legacyIsland.test.ts` and `tokenNames.test.ts` pass.
- [ ] **Step 2: Run the gate.** `pnpm check` from the repo root, with the pytest variables, and `pnpm build && node scripts/bundle-budget.mjs`. Expect both green. Commit the regenerated `cn-tables.ts` with the build.
- [ ] **Step 3: Visual pass (controller).** Every console page at 400 and 1440 px, light and dark, plus Linen and Midnight on `/admin/general` and `/settings/preferences`, in Chromium. At 400px, script a check for `document.documentElement.scrollWidth > innerWidth` on every page (Review Focus 4), and run axe on every console page, not only the eight in e2e.
- [ ] **Step 4: Production-bundle smoke (controller).** Serve `dist` from the API with its real CSP, in Chromium, Firefox and WebKit. Check:
  - no console chunk and no Base UI overlay code in `index.html`'s first load;
  - every console page loads with no console error and no CSP violation;
  - the Sheet opens, closes on Escape, and returns focus;
  - a confirm over the console takes one Escape.
- [ ] **Step 5: Commit.** `chore(console): close the legacy island, sweep what no page draws, and record phase 3`. Then hand over to the final review and the PR.
