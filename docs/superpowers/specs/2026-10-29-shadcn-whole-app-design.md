# Blob takes shadcn's look — design

2026-10-29. Status: awaiting the user's approval.

## Intent

The user asked to "fully apply" shadcn/ui across Blob. Asked to narrow it, they chose:

- **The whole client**, not only the three consoles.
- **shadcn's look**, not Blob's Meadow palette with shadcn underneath.
- **Preset `b0`** from `ui.shadcn.com/create`: style Nova, base colour Neutral, theme
  Neutral, chart colour Neutral, Inter for headings and text, Lucide icons, default
  radius, default/solid menus, subtle menu accent.
- **Workspace themes**: the user left this to the builder. Decided: keep them, re-keyed
  to shadcn's colour names (see "Themes").

So this is a re-skin of every screen, and a move to how shadcn builds UI: Tailwind
utilities in the markup, shadcn's components copied into the repo, and shadcn's CSS
variables as the token layer. The why, as far as it was said, is the look and the
component library itself. Nothing about the product's behaviour changes.

## What "done" means

- Every screen is drawn with shadcn components and Tailwind utilities on shadcn's
  variables, in preset `b0`. No file under `apps/web/src/styles/app/` is left, and
  `tokens.css` holds only shadcn's variables plus Blob's few extras.
- Checked by eye at 400px and 1440px wide, light and dark, per phase for the screens it
  touched.
- `pnpm check`, `alembic check`, `torsor guard`, the bundle budget and the e2e run (axe on
  its seventeen pages) all pass on every phase's PR.

## Goals

1. One visual language: shadcn `b0` everywhere — the consoles, the chat, auth, calls,
   agents, work channels, home, search, the palette.
2. shadcn components as the primitives: Button, Input, Textarea, Select, Switch,
   Checkbox, Tabs, Card, Table, Badge, Dialog, AlertDialog, DropdownMenu, ContextMenu,
   Popover, Tooltip, Toast, Command (for ⌘K), Sidebar, Sheet (narrow screens), Skeleton,
   ScrollArea, Avatar.
3. Custom workspace themes keep working, on shadcn's names.
4. Every phase ships to production on its own and looks finished there: no screen should
   look half-converted between phases.

## Non-goals

- No layout change. Blob stays Slack-shaped (channel list, conversation, thread or file
  panel on the right, ⌘K); "as familiar as Slack" still wins over any shadcn block that
  arranges things differently.
- No new features, and no server change beyond themes.
- No framework change (stays Vite + React 19, hand-rolled router, zustand).

## Anti-goals — it fails even if it "works" when

- A keyboard reflex breaks: one Escape closes one layer, focus returns to the opener,
  ⌘K, arrow keys in menus and lists, the 44px coarse-pointer minimum.
- Messages start re-animating on scroll or channel switch. The rule that motion is keyed
  to arriving, never to mounting (`freshMessages`, `lib/firstView.ts`, `Count.tsx`)
  survives the re-skin.
- An axe page regresses, or a muted grey drops below 4.5:1.
- A workspace's saved theme silently disappears.
- `livekit-client`, the consoles, xterm or the agent terminal reach the first load.
- A font or icon is fetched from a CDN. CSP is `font-src 'self' data:`, and the
  self-hosted fonts are a privacy rule (`index.html`, `public/fonts/fonts.css`).

## Constraints found in the code

- **The first load is 217.4 of 220 KB gzipped** (measured on main, 2026-10-29: entry
  149.9 KB + react 67.6 KB). shadcn's overlays run on Base UI (or Radix), and the chat
  itself uses menus, dialogs, tooltips and popovers, so that JS lands in the entry chunk.
  It will not fit in 2.6 KB. **Decided by the user: the first load may grow to at most
  260 KB gzipped.** Any phase may raise `BUDGET_KB` to what it measures, in the commit
  that says why (as `bundle-budget.mjs` asks), never past 260, and only after deleting
  what it replaces (`components/Menu.tsx`, `Dialog.tsx`, `usePresence` users,
  `Icon.tsx`). Whatever the chat does not need at first paint — the command palette, the
  emoji picker, dialogs nobody has opened — is lazy-loaded rather than spent from the
  ceiling. Phase 7 ratchets the budget down to what the finished app measures.
- **CSS today is 179.6 KB raw / 31.5 KB gzipped**, all first-load, from ~12,600 lines in
  `styles/app/*.css`. The CSS is not budgeted, but it should end smaller than it starts.
  Moving styling into Tailwind class strings moves bytes from the (unbudgeted) CSS into
  the (budgeted) entry JS, so phases 4 and 5 grow the entry chunk too — not only phase 2.
  `tailwind-merge` (behind `cn`), `cmdk` (Command) and the toast library are further
  candidates for the first load; each is either lazy or measured.
- **Tests key on class names.** About 346 `querySelector` calls in vitest files and a
  handful of e2e locators (`main.pane`, `.admin-main`, `article.message`,
  `.search-results`, `.console-copy .ellipsis`, `.attachment-chip[data-status]`). Each
  phase updates the tests for what it converts, preferring roles and labels over classes
  as it goes. Keep `main.pane` / `.admin-main` or change e2e in the same PR.
- **Dark mode has three states.** An explicit choice stamps `data-theme` on `<html>`;
  "system" stamps nothing and follows `prefers-color-scheme`. shadcn assumes a `.dark`
  class. Tailwind v4's `dark:` variant must be redefined with `@custom-variant` to match
  Blob's rule (or `lib/theme.ts` resolves "system" to an attribute) — either is fine,
  as long as "system" keeps following the OS live.
- **`--accent` collides.** In Blob it is the brand colour (forest green); in shadcn it is
  the subtle hover background, and shadcn's primary colour is `--primary`. Rename Blob's
  legacy uses before shadcn's variables land.
- **Overlays.** Blob's dialogs use native `<dialog>` with a 150 ms exit through
  `usePresence`/`DialogPresence`, and `useEscape` default-prevents the Escape it answers
  so one press closes one layer. Base UI components animate their own exit
  (`data-starting-style` / `data-ending-style`) and handle Escape and focus return. A
  converted overlay uses Base UI's mechanism and drops `usePresence`; the behaviours
  listed under anti-goals are what must survive, and the existing tests for them
  (`Dialog.test.tsx`, `Menu.test.tsx`, `ConfirmDialog.test.tsx`) are rewritten against the
  new components, not deleted.
- **CLAUDE.md's design-layer section and the 44-name contract** become wrong. The phase
  that changes them rewrites that section and adds an ADR (0043) recording this decision
  and superseding the Meadow choice.

## Current state of the art (checked 2026-10-29)

- shadcn/ui: CLI `shadcn@latest`; `init -t vite --preset b0`, then `add <component>`.
  Base UI has been the default primitive library since July 2026; Radix and React Aria
  are still offered. Presets replace the removed `--style`/`--base-color` flags. Use what
  preset `b0` resolves to, and record the resolved style and library in the ADR.
- Tailwind CSS v4.3 via `@tailwindcss/vite`, CSS-first config (`@import "tailwindcss"`,
  `@theme inline`). Needs Chrome 111, Safari 16.4, Firefox 128 — no narrower than Blob's
  floor today.
- shadcn's tokens are `oklch()` values on `:root` and in dark mode.

## How it is built

### Coexistence during the migration

Tailwind and the legacy stylesheets live side by side until the last phase. Declare the
layer order up front so neither fights the other by accident:

```css
@layer theme, base, legacy, components, utilities;
```

Tailwind's preflight is `base`; every legacy file is imported into `legacy`, so it beats
the reset and loses to utilities. A converted component carries utilities only, and its
legacy file is deleted in the same PR. (Unlayered legacy CSS would beat every utility,
which is why it must be layered.)

### Tokens

`tokens.css` becomes shadcn `b0`'s variables (`--background`, `--foreground`, `--card`,
`--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`,
`--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar-*`, `--radius`, and their
`-foreground` pairs), light and dark. Blob keeps a short list of extras that shadcn has
no word for: presence (online/away/offline), unread, and any the conversion proves it
needs. Elevation, motion, z-index and the coarse-pointer rule stay as Blob structure
tokens, restated in shadcn's terms where shadcn has one (radius, shadow).

In the first phase the legacy names are **bridged** to the new ones
(`--bg: var(--background)`, `--text: var(--foreground)`, `--danger: var(--destructive)`,
Blob's brand accent → `--primary`, …), so every unconverted screen takes `b0`'s colours,
font and radius the day phase 1 ships. That is what keeps every phase looking finished in
production. The bridges are deleted with the legacy CSS at the end.

### Themes

- `services/themes.py`: `THEMEABLE_TOKENS` becomes shadcn's colour names plus Blob's
  extras; `TOKEN_GROUPS` regrouped to match; the value grammar accepts `oklch()` as well
  as hex and `rgb()` (strict, no `var()`, no `calc()`, nothing that can carry a second
  declaration).
- An Alembic data migration rewrites stored themes old name → new name. Where several old
  names map to one new one, the most representative wins (e.g. `--text-3` →
  `--muted-foreground`, `--surface-hover` → `--accent`); names with no home are dropped.
  The migration is idempotent and logs nothing personal. Main rows:

  | Old | New |
  |---|---|
  | `--bg` | `--background` |
  | `--text` | `--foreground` |
  | `--surface` | `--card`, `--popover` |
  | `--surface-muted` | `--muted` |
  | `--surface-hover` | `--accent` |
  | `--text-3` | `--muted-foreground` |
  | `--hairline` | `--border` |
  | `--hairline-strong` | `--input` |
  | `--accent` | `--primary` |
  | `--accent-contrast` | `--primary-foreground` |
  | `--accent-border` | `--ring` |
  | `--bg-sidebar` | `--sidebar` |
  | `--accent-wash` | `--sidebar-accent` |
  | `--danger` | `--destructive` |
  | `--presence-*`, `--unread-*` | Blob extras, unchanged |

  The builder completes the table; anything dropped is listed in the migration's
  docstring.
- **The twelve shipped themes** (`PRESETS` in `services/themes.py`) all stay — none is
  retired, so nobody's chosen theme falls back silently. Paper and Midnight become `b0`
  light and dark exactly. The other ten (High contrast, Linen, Harbour, Sage, Blossom,
  Plum, Forest, Carbon, Ember, Slate) are re-keyed and their values adjusted until every
  text pair passes 4.5:1 against `b0`'s values for what they do not set (Linen's sidebar
  with `b0`'s muted grey is ~4.1:1 today). `ensure_presets` inserts once and never
  refreshes, so the phase 1 data migration rewrites the preset rows as well as custom
  ones. A contrast test over every preset × text pair guards it from then on.
- The admin theme editor and the Preferences picker are converted with the consoles, and
  `lib/theme.ts` keeps writing a theme as inline properties on `<html>`.

### Fonts and icons

Inter is self-hosted under `public/fonts/` like Instrument Sans today (variable woff2,
`font-display: swap`). Lucide via `lucide-react`, imported per icon so it tree-shakes;
`components/Icon.tsx` becomes a thin map onto Lucide or is replaced at its call sites.

### Where shadcn's code goes

`apps/web/src/components/ui/` for the copied shadcn components (shadcn's convention), the
`@` alias added to Vite and both tsconfigs, `components.json` at `apps/web/`. shadcn's
`cn` helper as the CLI installs it. Components are owned code from then on: lint, types
and tests apply.

## Phases — one PR each, each shippable

1. **Foundation.** This design and ADR 0043. Tailwind v4 + shadcn `init` with preset
   `b0`; layer order; legacy CSS into `@layer legacy`; `--accent` rename; `b0` tokens
   with the legacy bridge; Inter and the dark variant; the themes re-key (server,
   migration, editor kept working). After this PR the whole app wears `b0`'s colours,
   font and radius, with today's components.
2. **Primitives.** Add the shadcn components and replace `components/` (Dialog,
   ConfirmDialog, Confirmation, Menu, Toasts, EmptyState, ListSkeleton, Avatar,
   PersonCard, ShortcutHelp, EmojiPicker's shell) and Icon → Lucide. The budget is
   re-measured and raised here, with the reason, within the 260 KB ceiling.
3. **The three consoles** (`features/console`, `admin`, `settings`, `server`), including
   the theme editor. Stays out of the main chunk.
4. **The shell.** shadcn Sidebar for the channel list (the Meadow inset frame maps onto
   the sidebar's inset variant), the top bar, ⌘K as Command, workspace switcher, Sheet on
   narrow screens.
5. **The conversation.** Message list, composer, threads, reactions, attachments, the
   right-hand panel, code blocks, agent run cards, unread and typing notices. Motion rules
   re-verified here.
6. **Everything else.** Auth and OAuth consent, home, search, channel directory, work
   channels and artifacts, decisions, agents and the terminal's chrome, calls (lazy chunk
   stays lazy), help, feedback, what's new.
7. **Cleanup.** Delete `styles/app/`, the bridges and the `legacy` layer; rewrite
   CLAUDE.md's design-layer section; ratchet the budget down to what it measures; refresh
   the README screenshots.

Every PR: `pnpm check`, the budget, e2e with axe, and screenshots at 400 and 1440 px,
light and dark, of the screens it touched. A merge to main ships to production, so each
PR is merged only on the user's explicit go-ahead, by hand — never `gh pr merge --auto`.

## Left to the builder

Exact component list per phase; whether Icon.tsx stays as a map or goes; the
`@custom-variant` vs resolved-attribute choice for dark mode; completing the theme
mapping table; which Blob extras survive; test rewrites (prefer roles and labels).

## Calls made without the user

- Keep custom themes and migrate them (the user said "you choose").
- Keep the Meadow inset frame as shadcn's inset sidebar rather than dropping it.
- Phase order: tokens first so production never shows a half-converted app.
- Keep all twelve shipped themes, contrast-fixed, rather than retiring any.
- Phases 5 and 6 may ship as several PRs split by screen, each one finished on its own.
