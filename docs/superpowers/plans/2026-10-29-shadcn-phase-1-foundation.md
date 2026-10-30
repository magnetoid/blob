# shadcn Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen of Blob wears shadcn preset `b0` (colours, Inter, radius) with today's components, Tailwind v4 and shadcn are installed and scoped, and workspace themes are re-keyed to shadcn's names — shippable as one PR.

**Architecture:** Tailwind v4 via `@tailwindcss/vite`, scanning only converted paths (`source(none)` + `@source`). shadcn's `b0` variables live unlayered in `styles/theme.css`; all legacy CSS moves into `@layer legacy` and its colour tokens become `var()` bridges onto shadcn's variables, so unconverted screens restyle at once. Themes (server allowlist, grammar, presets, stored rows) move to shadcn's names in the same PR.

**Tech Stack:** Tailwind CSS 4.3, shadcn CLI (`shadcn@latest`, preset `b0` = style `base-nova`, Base UI, Lucide, Inter, radius `0.625rem`, base colour neutral), `@fontsource-variable/inter`, React 19, Vite 6, FastAPI + Alembic.

**Spec:** `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md`

## Global Constraints

- Work in the worktree `/Users/magnetoid/c/blob-shadcn`, branch `shadcn-1-foundation` cut from `shadcn-0-design`. Never touch `/Users/magnetoid/c/blob` (another session's checkout).
- First load ≤ 260 KB gzipped (`scripts/bundle-budget.mjs`); raise `BUDGET_KB` only to what is measured, in the commit that says why. Phase 1 is expected to fit 220.
- No font, icon or script from a CDN. CSP stays `font-src 'self' data:`.
- Every colour value a theme may store is hex, `rgb()`/`rgba()`, or `oklch()` (optional `/ alpha`) — nothing else.
- Every text pair a preset produces is ≥ 4.5:1.
- Next migration is `0078_*`; run `uv run alembic heads` before writing `down_revision`.
- SQL is `text()` with bound parameters; no `select(` / `session.add(` in services or routers.
- Error codes unchanged (`invalid_token` stays).
- Merge only on the user's explicit go-ahead, by hand. Never `gh pr merge --auto`.

## Review Focus

1. "System" mode with the OS flipping dark while the app is open → b0's dark values and Tailwind's `dark:` follow live, before and after JS (Task 3 test).
2. A browser holding last week's `blob.theme` in localStorage (old names, forest green) → no flash of the old palette on first paint (Task 5 test).
3. A custom theme whose only keys have no new home (e.g. just `--text-4`) → migrates to `{}` and stays selectable (Task 4 test).
4. An admin typing `oklch(62.8% 0.25 29.2 / 50%)` is accepted; `oklch(var(--x))`, `oklch(1 0 0); color:red` are refused with `invalid_token` (Task 4 test).
5. The theme editor opening a theme whose value is `oklch(...)` → the colour picker shows its hex equivalent, no crash (`toHex` tests in Task 3; editor wiring in Task 5).

---

### Task 1: Tailwind installed, colliding legacy token names renamed

Blob's unlayered tokens would override Tailwind's and shadcn's variables of the same name (`--text-xs`, `--radius-sm`, `--font-mono`, `--accent`, `--sidebar-width`, …). Rename Blob's side first, with no visual change.

**Files:**
- Modify: `apps/web/package.json` (add `tailwindcss`, `@tailwindcss/vite` at `^4.3`)
- Modify: every file under `apps/web/src` and `apps/web/public/theme-boot.js` that declares or reads a colliding name
- Create: `apps/web/src/styles/tokenNames.test.ts`

**Interfaces:**
- Produces: every colliding legacy token is now `--blob-<old name without leading -->` (e.g. `--text-xs` → `--blob-text-xs`, `--font-mono` → `--blob-font-mono`, `--sidebar-width` → `--blob-sidebar-width`), **and the whole `--accent*` family** goes with `--accent` (`--blob-accent`, `--blob-accent-hover`, `--blob-accent-wash`, …) so Blob's brand colours read as one family. Non-colliding names (`--font-ui`, `--text-2xs`, `--radius-full`, …) keep their names. Later tasks bridge these.

- [ ] **Step 1: Install** `pnpm --filter @blob/web add -D tailwindcss@^4.3 @tailwindcss/vite@^4.3` (no import yet).
- [ ] **Step 2: Write the failing test** `tokenNames.test.ts` → `it('declares no token that Tailwind or shadcn also declares')`: collect every `--name:` declared in `src/styles/tokens.css` and `src/styles/app/*.css`; collect every `--name:` in `node_modules/tailwindcss/theme.css`, plus this fixed list: `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --border --input --ring --chart-1 --chart-2 --chart-3 --chart-4 --chart-5 --radius --sidebar --sidebar-foreground --sidebar-primary --sidebar-primary-foreground --sidebar-accent --sidebar-accent-foreground --sidebar-border --sidebar-ring --sidebar-width --sidebar-width-icon --sidebar-width-mobile`; `expect(intersection).toEqual([])`.
- [ ] **Step 3: Run** `pnpm --filter @blob/web exec vitest run src/styles/tokenNames.test.ts` → FAIL listing the collisions.
- [ ] **Step 4: Rename** each listed name to `--blob-…` in every declaration and `var()` read across `apps/web/src` (css, ts, tsx — inline `style` objects and `getPropertyValue` included) and `public/theme-boot.js`. Do not touch `apps/api` (Task 4 re-keys themes), and leave theme *token keys* as they are in `lib/theme.ts`, `theme-boot.js`, `lib/themeContrast.ts`, `ThemesSection.tsx` and `PreferencesCard.tsx` — those are server data and Task 5 replaces them. Mechanical: a word-boundary replace per name, longest names first.
- [ ] **Step 5: Run** the test → PASS; `pnpm --filter @blob/web typecheck && pnpm --filter @blob/web exec vitest run` → all green (fix tests that assert old names).
- [ ] **Step 6: Build** `pnpm build` and diff `dist/assets/index-*.css` against main's (sizes within a few hundred bytes; only names changed).
- [ ] **Step 7: Commit** `refactor(web): give Blob's tokens that collide with Tailwind and shadcn a --blob- prefix`.

### Task 2: Tailwind and shadcn wired in, legacy CSS layered, scanning scoped

**Files:**
- Modify: `apps/web/vite.config.ts` (add `tailwindcss()` plugin; `resolve.alias` `'@' → path.resolve(__dirname, 'src')`)
- Modify: `apps/web/tsconfig.json` (`baseUrl: "."`, `paths: { "@/*": ["./src/*"] }`)
- Create: `apps/web/components.json`, `apps/web/src/lib/utils.ts` (whatever `cn` the CLI writes)
- Create: `apps/web/src/styles/index.css`
- Modify: `apps/web/src/main.tsx` (import `./styles/index.css` only)
- Test: `apps/web/src/styles/tokenNames.test.ts` (add a case)

**Interfaces:**
- Produces: `@/components/ui/*` resolves; `cn(...inputs): string` from `@/lib/utils`; `styles/index.css` is the single CSS entry; `styles/theme.css` (created in Task 3) is imported there.

- [ ] **Step 1: Run** `pnpm dlx shadcn@latest init -t vite --preset b0` from `apps/web`. When it asks for the CSS file, give `src/styles/theme.css`. Review its diff: keep `components.json`, `lib/utils.ts`, added deps; revert anything it wrote over existing files other than those named in this task. Record in the commit message what `components.json` says for `style`, `iconLibrary`, and the primitive library.
- [ ] **Step 2: Write `styles/index.css`** in exactly this order:
  ```css
  @layer theme, base, legacy, components, utilities;
  @import "tailwindcss" source(none);
  @source "../components/ui";
  @import "./theme.css";
  @import "./tokens.css" layer(legacy);
  @import "./app.css" layer(legacy);
  ```
  plus any `@import` the CLI added (e.g. `tw-animate-css`) after `tailwindcss`.
- [ ] **Step 3: Add test** `it('scans only converted paths')`: `index.css` contains `source(none)` and every `@source` line points under `src/components/ui` (later phases extend the allowed list in this test).
- [ ] **Step 4: Run** `pnpm --filter @blob/web exec vitest run && pnpm --filter @blob/web typecheck && pnpm --filter @blob/web lint` → green. `components/ui` is empty so far; lint rules apply to anything the CLI wrote.
- [ ] **Step 5: Build and look**: `pnpm build`; the app at 1440px is visually unchanged apart from Tailwind's preflight. Fix any preflight regressions (headings, lists, `img`, `button` resets) with a rule in the legacy layer's `base.css`, not by dropping preflight.
- [ ] **Step 6: Commit** `feat(web): Tailwind v4 and shadcn (preset b0), legacy CSS in its own layer`.

### Task 3: b0 tokens, the legacy bridge, dark variant, Inter

**Files:**
- Modify: `apps/web/src/styles/theme.css` (b0 variables, `@theme inline`, dark variant)
- Modify: `apps/web/src/styles/tokens.css` (colour tokens become bridges; Blob's dark palette blocks shrink to unbridged tokens)
- Modify: `apps/web/index.html` (drop `/fonts/fonts.css` link); Delete: `apps/web/public/fonts/`
- Modify: `apps/web/package.json` (`@fontsource-variable/inter`)
- Create: `apps/web/src/styles/theme.test.ts`
- Create: `apps/web/src/lib/color.ts`, `apps/web/src/lib/color.test.ts`

**Interfaces:**
- Consumes: Task 1's `--blob-*` names.
- Produces: `parseColor(value: string): Rgb | null` (hex, `rgb()/rgba()`, `oklch()` with optional `/ alpha`), `toHex(value: string): string | null` (`#rrggbb`), `contrastRatio(a: Rgb, b: Rgb): number`, and `interface Rgb { red; green; blue; alpha }` (moved from `themeContrast.ts`), all from `lib/color.ts`.
- Produces: shadcn variables (full list in Task 1 Step 2, minus `--sidebar-width*`) on `:root` light and dark; Tailwind colour utilities `bg-background`, `text-muted-foreground`, … via `@theme inline`; `dark:` variant; `--font-sans` = `'Inter Variable', system-ui, sans-serif`.

- [ ] **Step 1: Write the failing tests.** `color.test.ts`: `toHex('oklch(1 0 0)') === '#ffffff'`; `toHex('oklch(0.145 0 0)') === '#0a0a0a'`; `toHex('oklch(0.577 0.245 27.325)')` within 1 per channel of `#e7000b`; `parseColor('oklch(1 0 0 / 10%)')!.alpha === 0.1`; `parseColor('#1f5c3d')` and `parseColor('rgb(26 29 27 / 32%)')` still parse; `parseColor('oklch(var(--x))') === null`. `theme.test.ts` (reads the CSS as text):
  - `it('defines every b0 variable for light and dark')` — each name appears in the `:root` block and in both dark blocks.
  - `it('applies dark both before and after JS')` — dark values sit under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }` **and** `:root[data-theme='dark'] {…}`; and `@custom-variant dark` covers both the same way.
  - `it('keeps light muted text readable')` — with `parseColor`/`contrastRatio`, `--muted-foreground` on `--muted`, `--sidebar` and `--background` ≥ 4.5 in light and dark.
- [ ] **Step 2: Run** → FAIL. Then implement `lib/color.ts` (OKLCH → OKLab → linear sRGB → gamma, clamped; Ottosson's matrices) and move `Rgb` and the hex/rgb parsing out of `themeContrast.ts` into it; `color.test.ts` → PASS.
- [ ] **Step 3: Write `theme.css`.** Values are b0's exactly, except light `--muted-foreground: oklch(0.54 0 0)` (b0's 0.556 is 4.35:1 on `--muted`; note this in a comment and in the ADR). Light:
  `--background 1 0 0 · --foreground .145 0 0 · --card/--popover 1 0 0 · --card/--popover-foreground .145 0 0 · --primary .205 0 0 · --primary-foreground .985 0 0 · --secondary/--muted/--accent .97 0 0 · --secondary/--accent-foreground .205 0 0 · --destructive .577 .245 27.325 · --border/--input .922 0 0 · --ring .708 0 0 · --chart-1..5 .87/.556/.439/.371/.269 0 0 · --radius .625rem · --sidebar .985 0 0 · --sidebar-foreground .145 0 0 · --sidebar-primary .205 0 0 · --sidebar-primary-foreground .985 0 0 · --sidebar-accent .97 0 0 · --sidebar-accent-foreground .205 0 0 · --sidebar-border .922 0 0 · --sidebar-ring .708 0 0`.
  Dark: `--background .145 · --foreground .985 · --card/--popover .205 · --card/--popover-foreground .985 · --primary .922 · --primary-foreground .205 · --secondary/--muted/--accent .269 · --secondary/--accent-foreground .985 · --muted-foreground .708 · --destructive .704 .191 22.216 · --border 1 0 0 / 10% · --input 1 0 0 / 15% · --ring .556 · --chart-* same as light · --sidebar .205 · --sidebar-foreground .985 · --sidebar-primary .488 .243 264.376 · --sidebar-primary-foreground .985 · --sidebar-accent .269 · --sidebar-accent-foreground .985 · --sidebar-border 1 0 0 / 10% · --sidebar-ring .556` (all `oklch(L C H)`, chroma 0 where not given).
  Then `@theme inline` mapping `--color-<name>: var(--<name>)` for each, `--radius-sm/md/lg/xl` from `--radius` as shadcn writes them, `--font-sans`. Dark variant:
  ```css
  @custom-variant dark {
    @media (prefers-color-scheme: dark) { &:where(:root:not([data-theme='light']), :root:not([data-theme='light']) *) { @slot; } }
    &:where([data-theme='dark'], [data-theme='dark'] *) { @slot; }
  }
  ```
  `@import "@fontsource-variable/inter";` at the top of `theme.css`.
- [ ] **Step 4: Bridge `tokens.css`.** Replace each legacy colour value with a `var()` onto shadcn, in both themes (dark blocks then lose these names entirely):

  | Legacy | Bridge |
  |---|---|
  | `--bg` | `--background` |
  | `--bg-rail`, `--bg-sidebar` | `--sidebar` |
  | `--surface` | `--card` |
  | `--surface-hover`, `-hover-warm`, `-hover-deep`, `--surface-row-hover` | `--accent` |
  | `--surface-muted`, `--surface-icon`, `--avatar-bg`, `--disabled-bg` | `--muted` |
  | `--hairline`, `--hairline-soft`, `--hairline-popover`, `--blob-accent-border-soft`, `--scrollbar` | `--border` |
  | `--hairline-strong`, `--blob-accent-border` | `--ring` |
  | `--text`, `--text-body`, `--text-2` | `--foreground` |
  | `--text-3`, `-4`, `-5`, `--text-label`, `--text-faint`, `--text-rail`, `--disabled-fg` | `--muted-foreground` |
  | `--blob-accent` | `--primary` |
  | `--blob-accent-hover` | `color-mix(in oklab, var(--primary) 90%, transparent)` |
  | `--blob-accent-contrast` | `--primary-foreground` |
  | `--blob-accent-wash`, `-wash-rail`, `-wash-soft` | `--sidebar-accent` |
  | `--danger` | `--destructive` |
  | `--track-off` | `--input` |
  | `--knob` | `--background` |
  | `--font-ui` | `--font-sans` |
  | legacy radius steps | nearest of `--radius-sm/md/lg/xl` |

  (Use the exact `--blob-` names Task 1 produced.) Presence, unread, iris, clay, backdrop, elevation, motion, z-index, sizes stay as they are.
- [ ] **Step 5: Fonts.** `pnpm --filter @blob/web add @fontsource-variable/inter`; remove the `fonts.css` link from `index.html` and delete `public/fonts/`; grep for `instrument` → nothing left.
- [ ] **Step 6: Run** `vitest run src/styles` → PASS; full web suite, typecheck, lint → green.
- [ ] **Step 7: Look.** `pnpm dev` with the seeded workspace; screenshot channel view, a thread, `/admin`, `/settings`, sign-in at 400 and 1440 px, light and dark. Nothing may be unreadable or invisible (hover rows, selected channel, focus rings, toggles, unread line). Fix in the bridge, not per component.
- [ ] **Step 8: Commit** `feat(web): the whole client takes shadcn b0's colours, Inter and radius through a bridge`.

### Task 4: Themes on shadcn's names (server)

**Files:**
- Modify: `apps/api/src/blob_api/services/themes.py` (`THEMEABLE_TOKENS`, `TOKEN_GROUPS`, `_COLOR_RE`, `PRESETS`)
- Create: `apps/api/src/blob_api/db/migrations/versions/0078_themes_on_shadcn_names.py`
- Modify: `apps/api/tests/test_themes.py`; Create: `apps/api/tests/test_theme_rekey_migration.py`
- Modify: `packages/shared` only if a theme type names tokens (check; regenerate `openapi.json` with `pnpm openapi` if the schema changed)

**Interfaces:**
- Produces: `TOKEN_GROUPS: dict[str, tuple[str, ...]]` written out explicitly (no index slicing) as
  `Surfaces: --background --card --popover --muted --secondary --accent --sidebar` ·
  `Text: --foreground --card-foreground --popover-foreground --muted-foreground --secondary-foreground --accent-foreground --sidebar-foreground` ·
  `Brand: --primary --primary-foreground --sidebar-primary --sidebar-primary-foreground --sidebar-accent --sidebar-accent-foreground --ring --sidebar-ring` ·
  `Lines: --border --input --sidebar-border` ·
  `State: --destructive --presence-online --presence-away --presence-offline --unread-line --unread-text` ·
  `Charts: --chart-1 … --chart-5`; `THEMEABLE_TOKENS = tuple(t for g in TOKEN_GROUPS.values() for t in g)`.
- Produces (migration module): `REKEY: dict[str, tuple[str, ...]]` and `rekey(tokens: dict[str, str]) -> dict[str, str]`.

- [ ] **Step 1: Write failing tests** in `test_themes.py`:
  - extend `test_accepts_colours` params with `"oklch(0.54 0 0)"`, `"oklch(62.8% 0.25 29.2 / 50%)"`, `"oklch(1 0 0 / 10%)"`, `"oklch(0.5 0.1 120deg)"`;
  - extend the rejection params with `"oklch(var(--x))"`, `"oklch(1 0 0); color: red"`, `"oklch(calc(1) 0 0)"`, `"oklch(1 0)"`;
  - `test_rejects_tokens_outside_the_allowlist` now also refuses `"--bg"` (an old name);
  - `test_every_preset_is_readable`: for each preset, fill unset names from `B0_LIGHT_HEX` / `B0_DARK_HEX` (constants in the test: b0's values as hex — e.g. light `--background #ffffff`, `--muted #f5f5f5`, `--sidebar #fafafa`, `--primary #171717`, and `--muted-foreground #6e6e6e` for `oklch(0.54 0 0)`; dark `--background #0a0a0a`, `--card #171717`, `--muted #262626`, `--muted-foreground #a1a1a1`; alpha borders are not text and are not checked), then assert ≥ 4.5 for `foreground/background`, `card-foreground/card`, `popover-foreground/popover`, `primary-foreground/primary`, `secondary-foreground/secondary`, `accent-foreground/accent`, `muted-foreground/background`, `muted-foreground/muted`, `muted-foreground/card`, `muted-foreground/sidebar`, `sidebar-foreground/sidebar`, `sidebar-accent-foreground/sidebar-accent`, `destructive/background`;
  - `test_groups_cover_the_allowlist_once`.
- [ ] **Step 2: Write failing** `test_theme_rekey_migration.py` (load the migration with `importlib` by path):
  - `test_rekey_maps_old_names`: `rekey({"--bg": "#fff", "--accent": "#1f5c3d", "--text": "#111"})` == `{"--background": "#fff", "--primary": "#1f5c3d", "--sidebar-primary": "#1f5c3d", "--foreground": "#111", "--card-foreground": "#111", "--popover-foreground": "#111", "--accent-foreground": "#111", "--sidebar-foreground": "#111"}`;
  - `test_rekey_drops_names_with_no_home`: `rekey({"--text-4": "#666"}) == {}`;
  - `test_rekey_is_idempotent`: `rekey(rekey(x)) == rekey(x)` and already-new keys pass through unchanged;
  - `test_upgrade_rewrites_custom_and_preset_rows` (DB): insert a custom theme with old names and a preset row `linen` with old tokens, run the migration's upgrade body against the test session, assert the custom row is rekeyed and `linen` now equals the frozen new preset tokens.
- [ ] **Step 3: Run** `cd apps/api && uv run pytest tests/test_themes.py tests/test_theme_rekey_migration.py -q` → FAIL.
- [ ] **Step 4: Implement** in `services/themes.py`: the groups above; `_COLOR_RE` adds `oklch\(\s*\d*\.?\d+%?\s+\d*\.?\d+%?\s+\d*\.?\d+(?:deg)?\s*(?:/\s*\d*\.?\d+%?\s*)?\)`; `PRESETS` rewritten on new names — Paper and Midnight `{}`, the other ten derived by `rekey` from their current values and then adjusted (darken a light foreground / lighten a dark one in the smallest step) until `test_every_preset_is_readable` passes. Values stay hex.
- [ ] **Step 5: Implement the migration** `0078`: `REKEY` =
  `--bg→(--background)`, `--surface→(--card,--popover)`, `--surface-muted→(--muted)`, `--surface-hover→(--accent)`, `--text→(--foreground,--card-foreground,--popover-foreground,--accent-foreground,--sidebar-foreground)`, `--text-3→(--muted-foreground)`, `--hairline→(--border,--sidebar-border)`, `--hairline-strong→(--input)`, `--accent→(--primary,--sidebar-primary)`, `--accent-contrast→(--primary-foreground,--sidebar-primary-foreground)`, `--accent-border→(--ring,--sidebar-ring)`, `--bg-sidebar→(--sidebar)`, `--accent-wash→(--sidebar-accent)`, `--danger→(--destructive)`, `--presence-online/away/offline`, `--unread-line/text` → themselves; any key already in the new allowlist passes through; everything else dropped. `upgrade()`: for non-preset rows, `UPDATE themes SET tokens = :new WHERE id = :id` with `rekey`; for preset rows, set tokens to a **frozen copy** of the new `PRESETS` tokens by slug (copied into the migration, not imported). `downgrade()`: no-op with a docstring saying the old names cannot be reconstructed. List the dropped names in the module docstring. `text()` + bound params only.
- [ ] **Step 6: Run** the two test files → PASS; `uv run alembic heads` (one head), `uv run alembic check` quiet, `uv run mypy src`, `uv run ruff check src tests`.
- [ ] **Step 7: Commit** `feat(themes): themes speak shadcn's colour names, accept oklch, and stored ones are rekeyed`.

### Task 5: The client's theme pieces on the new names

**Files:**
- Modify: `apps/web/src/lib/themeContrast.ts` (+ test), `apps/web/src/lib/theme.ts` (+ test), `apps/web/public/theme-boot.js` (+ `lib/theme-boot.test.ts`), `apps/web/src/features/admin/sections/ThemesSection.tsx`, `apps/web/src/features/settings/PreferencesCard.tsx`

**Interfaces:**
- Consumes: `parseColor`, `toHex`, `contrastRatio`, `Rgb` from `lib/color.ts` (Task 3).

- [ ] **Step 1: Failing tests.** `themeContrast.test.ts`: pairs use new names (`--foreground/--background`, `--muted-foreground/--background`, `--primary-foreground/--primary`, `--destructive/--background`, `--sidebar-foreground/--sidebar`) and accept an oklch palette. `theme-boot.test.ts`: `it('ignores a palette stored under the old key')` — `localStorage['blob.theme']` with `--accent: #1f5c3d` sets no inline property; `blob.theme.v2` is read. `theme.test.ts`: meta `theme-color` comes from `--primary`, default `#171717` light / `#e5e5e5` dark.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `themeContrast.ts` uses `lib/color.ts` with the new pairs. `theme.ts` and `theme-boot.js`: `STORAGE_KEY = 'blob.theme.v2'`, meta colour from `--primary`. `ThemesSection`: the `<input type="color">` value from `toHex`, swatch from `--primary`, the help text no longer names `--accent-hover`. `PreferencesCard` preview: `--background`, `--sidebar`, `--muted`, `--primary`, fallbacks b0's hex.
- [ ] **Step 4: Run** web vitest, typecheck, lint → green.
- [ ] **Step 5: Look.** `/admin/themes`: edit Linen, change primary, preview applies live; `/settings` palette gallery shows twelve distinct previews; switch light/dark/system and flip the OS while open.
- [ ] **Step 6: Commit** `feat(web): theme editor, picker and contrast check on shadcn's names`.

### Task 6: Record it, gate it, open the PR

**Files:**
- Create: `.torsor/architecture/decisions/0043-blob-takes-shadcns-look.md` (decision, the b0 resolution from Task 2, the `--muted-foreground` deviation, themes rekey, the 260 KB ceiling, supersedes the Meadow identity)
- Modify: `CLAUDE.md` — "The design layer": the 44-name contract becomes "shadcn's colour names plus Blob's presence/unread extras, grouped explicitly in `TOKEN_GROUPS`"; values may be hex, `rgb()` or `oklch()`; legacy CSS lives in `@layer legacy` and bridges onto shadcn until phase 7; Tailwind scans only converted paths. Leave the frame and motion rules as they are.

- [ ] **Step 1: Write** the ADR and the CLAUDE.md edits.
- [ ] **Step 2: Gate.** `pnpm check` green; `cd apps/api && uv run alembic check` quiet; `torsor guard --strict --severity error $(git ls-files '*.py')` clean; `pnpm build && node scripts/bundle-budget.mjs` ≤ budget (if over 220, raise `BUDGET_KB` to the measured value ≤ 260 in its own commit saying why). With storage up (`docker compose up -d`) so attachment tests do not skip.
- [ ] **Step 3: e2e.** If a fresh server can be stood up locally as CI does, run `E2E_BASE_URL=… pnpm --filter @blob/e2e e2e`; otherwise say so in the PR and rely on CI's `image` job (axe on seventeen pages).
- [ ] **Step 4: Screenshots** at 400 and 1440 px, light and dark: channel, thread, `/admin/themes`, `/settings`, sign-in. Attach to the PR.
- [ ] **Step 5: Push and open the PR** `feat: shadcn phase 1 — the whole client in b0 (foundation)` against `main`, design and plan linked, the ADR named, screenshots attached. Do not merge.

---

## Phases 2–7 (each planned when it starts, from what the previous one measured)

2. **Primitives** — shadcn Button, Input, Textarea, Select, Switch, Checkbox, Tabs, Card, Table, Badge, Dialog, AlertDialog, DropdownMenu, ContextMenu, Popover, Tooltip, Toast, Skeleton, ScrollArea, Avatar replace `components/` and Icon → Lucide; `@source` gains each converted path; overlay behaviours (one Escape per layer, focus return) re-tested; budget re-measured ≤ 260.
3. **Consoles** — `features/console|admin|settings|server` on the primitives, legacy console CSS deleted.
4. **Shell** — Sidebar (inset variant for the frame), top bar, Command for ⌘K, switcher, Sheet on narrow screens.
5. **Conversation** — may ship as several PRs by screen; motion rules re-verified.
6. **Everything else** — may ship as several PRs by screen.
7. **Cleanup** — delete `styles/app/`, the bridges and `@layer legacy`; Tailwind back to automatic source detection; budget ratcheted down; CLAUDE.md design-layer rewritten; README screenshots refreshed.
