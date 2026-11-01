---
type: decision
status: accepted
tags: [adr, design, web, themes, shadcn, tailwind]
links:
  [
    0007-user-content-is-data-never-code,
    0008-one-image-one-origin,
  ]
rules: []
---

# ADR 0043: Blob takes shadcn's look, a phase at a time

## Context

Until now Blob drew itself with its own CSS: about 12,600 lines under
`apps/web/src/styles/app/`, spending a hand-made token vocabulary in `tokens.css`, in the
palette called Meadow — a forest-green accent, warm paper greys, Instrument Sans — and its
inset-card frame. On 2026-10-29 the user asked for shadcn/ui to be applied across Blob.
Asked to narrow it, they chose the whole client rather than the consoles alone, shadcn's
look rather than Meadow's palette under shadcn's components, and preset `b0` from
`ui.shadcn.com/create`. What to do with workspace themes they left to the builder. The
design is `docs/superpowers/specs/2026-10-29-shadcn-whole-app-design.md`; it moves the
client in seven phases, each its own PR and each shippable, and this ADR is written with
the first. The product's behaviour does not change.

The constraint that shaped phase 1: a merge to `main` ships to production, so no phase may
leave a screen half-converted. Phase 1 therefore changes how every screen *looks* — colour,
type, radius — without yet converting a single component.

## Decision

**Blob wears shadcn's preset b0 everywhere, through variables. Tailwind and shadcn's
components come in over the next phases; until the last, the old CSS lives in a layer of
its own and reads shadcn's variables through bridges. A workspace theme is written in
shadcn's colour names.**

- **What b0 resolved to** (shadcn CLI, 2026-10-29): style `base-nova` (shadcn's "Nova"),
  primitives **Base UI** (`@base-ui/react`) and not Radix, icons Lucide, font Inter, radius
  `0.625rem`, base colour neutral, menus default and subtle. Tailwind is v4.3 through
  `@tailwindcss/vite`, configured in CSS. Inter comes from `@fontsource-variable/inter`,
  imported by `styles/index.css` so Vite bundles the woff2 and it is served from this
  origin: the CSP's `font-src 'self' data:` stays, and no font is fetched from a CDN
  (ADR 0008). shadcn's code lives in `apps/web/src/components/ui/`, imported through the
  `@` alias, with `components.json` at `apps/web/`; it is owned code, under Blob's lint and
  types.
- **One stylesheet, in layers.** `styles/index.css` is the only CSS entry. It opens with
  `@layer theme, base, legacy, components, utilities;`, imports Tailwind with
  `source(none)`, and adds an `@source` for each directory whose components have been
  converted — only `components/ui` so far. A path joins that list when its components are
  rewritten and not before: scanning the legacy markup would turn every class-like string
  in it into a utility nobody asked for. shadcn's variables are unlayered, in
  `styles/theme.css`; `tokens.css` and `app.css` are imported into `@layer legacy`, so they
  beat Tailwind's preflight and lose to a utility without an `!important` anywhere.
  Preflight is repaired for the legacy CSS by the block that opens `styles/app/base.css`:
  `revert` on margin, padding, border and the like, skipped inside `[data-slot]` so
  shadcn's own markup keeps the reset it was written against.
- **A name Blob and shadcn both owned is Blob's to give up.** shadcn's variables are
  unlayered and so outrank anything in `legacy`, and Tailwind's own sit in `theme`, which
  `legacy` outranks — either way a shared name silently changes meaning on one side.
  Blob's side was renamed with a `--blob-` prefix before shadcn's variables landed: the
  type scale (`--blob-text-*`), `--blob-radius-*`, `--blob-ease-in|out`,
  `--blob-font-mono`, `--blob-sidebar-width`, and the whole `--accent*` family, because
  `--accent` is Blob's brand green and shadcn's hover wash. `tokenNames.test.ts` fails when
  a Blob token shares a name with Tailwind's theme or shadcn's variables again, and when a
  rule under `styles/app/` reads one of theirs: only `tokens.css`, the bridge, may.
- **The legacy colour tokens are bridges.** `--bg`, `--text`, `--surface`, `--hairline`,
  `--danger` and the rest are `var()`s onto shadcn's variables, so a screen nobody has
  converted wears b0's colours the day this ships, and follows `--background` into dark by
  itself. Blob keeps a value of its own only where shadcn has no word: presence, unread,
  the agents' and people's tints, the backdrop, and every structure token — elevation,
  motion, stacking, density, and the frame. The radius scale is now derived from shadcn's
  `--radius`. The bridges are deleted with the legacy CSS in phase 7.
- **Dark mode keeps Blob's three states.** An explicit choice stamps `data-theme` on
  `<html>`; "system" stamps nothing and follows the OS, live, with no script. shadcn assumes
  a `.dark` class, which would make "system" a JavaScript job and flash on load, so
  `theme.css` writes the dark palette twice — under `@media (prefers-color-scheme: dark)`
  for `:root:not([data-theme='light'])`, and under `:root[data-theme='dark']` — and
  redefines Tailwind's `dark:` with `@custom-variant` to the same two conditions. The two
  copies are held identical by a test, and nothing may key on `.dark`.
- **Departures from b0's values, all for contrast.** Light `--muted-foreground` is
  `oklch(0.54 0 0)` where b0 has `0.556`, which is 4.34:1 on b0's own `--muted` and under
  WCAG AA; 0.54 is 4.64:1. Light `--destructive` is `oklch(0.54 0.22 27.3)` (`#d00114`)
  where b0 has `0.577 0.245 27.325` (`#e7000b`): Blob draws danger text on an 8% tint of
  itself (`.role-pill`, `.task-badge`, `.feedback-kind`, `.janus-banner`), and b0's red is
  4.13:1 there and 4.37:1 on `--muted`, where this one is 4.91:1 and 5.20:1 (5.67:1 on the
  page) — a slightly deeper red than shadcn's. Light `--unread-text` is `#a0663a`, because
  the colour it replaced was 4.42:1 on the page. In dark, an off switch's knob takes
  `--foreground`, through a dark-only bridge, as shadcn's own Switch does: the knob the
  bridge would otherwise give it, `--background`, is 1.7:1 on the off track.
  `styles/theme.test.ts` holds every b0 value, measures the muted grey on every ground it is
  drawn on, and measures destructive on the page, a card, the muted grounds and its own tint.
- **The themeable names are shadcn's, plus Blob's extras.** `services/themes.py` allowlists
  36 names in six groups — Surfaces, Text, Brand, Lines, State (destructive, presence,
  unread), Charts — by string. The groups are written out, not cut from one tuple by index
  as the 44 legacy names were, so adding a name moves nothing else. Only colour is
  themeable: `--radius` and every structural variable are not. A value is a hex colour, an
  `rgb()`/`rgba()`, or an `oklch()` — shadcn's own notation — with literal numbers only and
  ASCII only: no `var()`, no `calc()`, nothing that could carry a second declaration
  (ADR 0007: a theme is data, never CSS).
- **Stored themes were rekeyed, and the presets replaced.** Migration `0078` renames every
  stored theme's tokens old name to new. A name with one home goes there; one shadcn has
  several homes for (`--text` coloured the page, cards, popovers, a hover wash and the
  sidebar) goes to all of them; where the old stylesheet had several names for what shadcn
  has one (five greys of muted text, four hover washes) the first the theme sets fills it;
  thirteen old names have no counterpart and are dropped, listed in the migration's
  docstring, so a custom theme that set one loses that one colour and keeps the rest. `ensure_presets` inserts once and never refreshes, so the same
  migration overwrites the twelve shipped presets by slug with a frozen copy — Paper and
  Midnight are b0 light and dark exactly and set nothing, and the other ten are adjusted
  until every text pair, destructive on the sidebar included, is 4.5:1 against b0's values
  for what they leave unset, and their red reads at 4.5:1 on the 8–9% wash of itself that
  pills and badges are drawn on (`tests/test_themes.py` holds both from then on). None was
  retired: nobody's chosen theme falls back silently. The rewrite is safe to meet twice —
  a dict that already holds a name only the new vocabulary has is left alone — and
  `downgrade` is a best-effort inverse, not a no-op (see "Rolling back" below). The client
  keeps the palette it replays before hydration under `blob.theme.v2`, and never replays
  the old key's palette, because a stored `--accent` would now paint shadcn's hover wash
  in the old brand colour; the one thing it takes from the old key, on the first load
  after the move and until hydration removes it, is the viewer's explicit light or dark
  choice, so that someone who chose dark on a light OS does not see a light page until the
  bootstrap answers.
- **Browser chrome follows the page, not the brand.** The `theme-color` meta and the
  manifest's `theme_color` and `background_color` are `--background` (`#ffffff` light,
  `#0a0a0a` dark when no theme sets one). b0's `--primary` is near-black in light and
  near-white in dark, so a bar in that colour is a stark band over the page in both.
  `lib/theme.ts` writes the chrome as hex, because not every engine reads `oklch()` in a
  `<meta>`; `B0_HEX` carries b0's few values as hex for that and for editor swatches, and a
  test holds them to `theme.css`. The manifest cannot follow dark, and says white.
- **Meadow's palette goes; its frame stays.** This ADR supersedes the Meadow palette — its
  forest-green accent, warm paper greys and Instrument Sans — and keeps Meadow's frame.
  Light is unchanged: `.shell > .pane` and `.shell > .panel` are one card on the ground the
  top bar and the channel list share. In dark the arrangement is shadcn's: the ground
  (`--sidebar`, `oklch(0.205)`) is now *lighter* than the card (`--background`,
  `oklch(0.145)`), where Meadow set the ground below the page so the card lifted. The card is still a card; it no longer rises out of a
  darker well. Phase 4 maps the frame onto shadcn's inset sidebar.
- **The first load may grow to 260 KB gzipped.** It was 217.4 of 220 on `main`, and
  shadcn's overlays on Base UI will not fit in the 2.6 KB left. The user approved the
  ceiling; a phase raises `BUDGET_KB` to what it measures, in its own commit and never past
  260, and only after deleting what its components replace. Phase 1 measures 219.2 KB — the entry chunk
  is 151.6 and React 67.6 — and so leaves `BUDGET_KB` at 220 with 0.8 KB to spare: it fits,
  and the ceiling is raised by phase 2, whose Base UI overlays will not. Phase 7 ratchets
  the number down to what the finished app costs.

## Consequences

- The whole client changes appearance the day phase 1 merges: neutral greys instead of
  Meadow's warm greens, Inter instead of Instrument Sans, shadcn's radius. Every screen is
  readable and nothing is half-converted, but the screens still draw their own markup;
  they will look like b0 in colour before they look like shadcn in structure.
- Two CSS systems coexist for six phases. The stylesheet grew (31.7 to 37.4 KB gzipped at
  Tailwind's arrival, before any legacy rule left), and the entry chunk grows as classes
  replace rules. Each phase deletes the legacy file for what it converts, in the same PR.
- A custom theme survives, rekeyed, on the colours that have a home; colours that had none
  are gone for good. A theme saved before this release and replayed from a browser's
  `blob.theme` is ignored once, its light or dark choice apart, then replaced by the
  server's answer.
- `tests/test_theme_rekey_migration.py` pins the frozen presets and 0078's name lists to the
  live code (`test_the_frozen_presets_are_the_ones_shipped`, and `NEW_NAMES` equal to
  `THEMEABLE_TOKENS`). The first legitimate change to a preset or a themeable name will fail
  them; that is the moment to snapshot the migration's copy, not to edit it.
- Dark mode costs two copies of one palette, kept identical by a test, so that "system"
  works before JavaScript and an explicit choice works after it.
- **Rolling back past 0078 is a database step, not only an image step.** The old client
  applies `--accent` in both vocabularies, so a theme left on the new names would paint
  its hover wash in the brand colour on nine of the twelve presets and on any custom theme
  that set one; the old server refuses to save a rekeyed theme; and an old image cannot
  boot against a database at 0078 (Alembic: "Can't locate revision"). A plain revert PR
  passes CI on a fresh database and then fails to start in production. So run `alembic
  downgrade 0077` from the **new** image, in its running app container (the working
  directory holds `alembic.ini`), and only then repoint `BLOB_IMAGE_TAG` at an older
  commit; the new image's entrypoint upgrades again on every start, so do not restart it
  in between. The downgrade restores the twelve presets exactly and gives each custom
  theme back the colours the old vocabulary has a name for; the thirteen dropped names,
  the fallback greys and washes that shared a home, and the new vocabulary's own
  (`--secondary`, `--chart-*` …) do not come back, and an `oklch()` value, which the old
  grammar refused, is carried over as written. Upgrading again afterwards is safe.
- `CLAUDE.md`'s design-layer section is rewritten for this state, not for the end of the
  migration; phase 7 rewrites it again.

## Alternatives considered

- **Radix primitives under shadcn.** Still offered; rejected because b0 resolves to Base
  UI and the preset is what the user chose. Base UI animates its own exit and returns
  focus itself, which is what lets phase 2 retire `usePresence` and `DialogPresence`.
- **Meadow's palette on shadcn's components.** Rejected by the user: the point was the look.
- **Retiring custom themes.** Rejected: a workspace's saved theme must not disappear
  silently, and the twelve presets are what a person has to choose from.
- **Converting screen by screen, with the old and new palettes side by side.** Rejected:
  production would show a half-converted app for months. Bridging the legacy names onto
  b0's variables makes phase 1 one coherent look.
- **Leaving the legacy CSS unlayered.** Rejected: unlayered rules beat every layer, so no
  utility could ever override a legacy rule without `!important`.
- **shadcn's `.dark` class, or resolving "system" to an attribute in JavaScript.**
  Rejected: either makes the OS preference a script's business, and the page paints in
  the wrong mode until it runs. Blob's attribute-plus-media-query rule already does the
  job, and `@custom-variant` points `dark:` at it.
- **Keeping Blob's `--accent` and renaming shadcn's.** Rejected: shadcn's components and
  its CLI write `--accent`, and every `add` would fight the rename.

## Phase 2: primitives (2026-11-01)

Phase 2 replaced what `components/` draws — Dialog, ConfirmDialog, Confirmation, Menu,
Toasts, EmptyState, ListSkeleton, Avatar, PersonCard and the emoji picker's shell — and
put Icon on Lucide, with every public name and prop unchanged and no caller edited but one
attribute. What it decided, and why:

- **Overlays load after first paint, behind one lazy boundary.** shadcn's dialog, alert
  dialog, dropdown menu and popover stand on Base UI's overlay code and floating-ui.
  Imported statically under Vite 6, Base UI's menu alone took the first load from 219.1 to
  278.7 KB, its popover to 259.7 and its dialog to 243.4, and the chunk holding all four
  generated modules was 72.6 KB gzipped. Holding only what the four `*Impl`s use, it was
  45.2 KB under Vite 6 — smaller too because the Base UI internals and `cn` it shares with
  the avatar now come with the first load — and is 41.8 KB by `scripts/bundle-budget.mjs`'s
  method after the Vite 8 merge (41.9 with the fixes that closed the phase). The user chose
  to keep it off the first load (option A, 2026-10-30). `components/overlays/index.ts` is
  the barrel the chunk is built from and
  `lib/overlays.ts` the only module that imports it — dynamically, once, forgetting a
  failure so the next caller tries again. `preloadOverlays` asks for it once `App` has
  mounted and the browser is idle (`requestIdleCallback` with a 4 s timeout; a timer where
  there is none), and not at all on the unsubscribe or OAuth consent page, which open no
  overlay. `components/lazyOverlay.tsx` makes a component of one export: nothing until the
  chunk is here, and once it is, the overlay in the same render — a dialog's body must be
  in the document before its caller's effects run. Each first-load half mounts its lazy
  half on open and drops it after the exit, so a chunk that failed to load draws nothing
  and logs, and is asked for again on every render of a wrapper still mounted and on the
  next opening. The failure is caught where the import is awaited, not by a boundary round
  the overlay, so a render error in a dialog body or a menu item still reaches the app's
  `ErrorBoundary` and its report. A retry helps a transient failure, in an engine that
  fetches a failed module again; after a deploy mid-session the old chunk answers 404
  every time and only a reload helps. So `lib/staleBuild.ts`, installed in `main.tsx`,
  listens for `vite:preloadError` — which Vite 8's preload helper dispatches on `window`
  when a dynamic import rejects, as the built output shows — and says once per page, in a
  toast, that Blob was updated while the page was open and wants a reload. It does not
  prevent the default, so the import still rejects into `lazyOverlay`'s catch; it covers
  every lazy chunk, the consoles' and the calls' too; and it says nothing while the browser
  reports itself offline, where the network is the likelier story.
  `scripts/bundle-budget.mjs` fails the build when a first-load chunk carries
  `OVERLAY_SDK` — `data-base-ui-inert`, `--available-height` or `referenceHidden`, strings
  the browser reads and minification keeps — and when no chunk carries any of them,
  because the guard would then have gone blind.
- **Dialogs are Base UI's.** `components/overlays/DialogImpl.tsx` is the shell: shadcn's
  `Dialog` root and portal, Base UI's backdrop and popup at `--z-modal`, moving on the
  legacy `overlay-in`/`overlay-out`, which travel only by the motion tokens. Base UI draws
  a portal's contents a render or two after the portal, and every form here focuses its
  first field in a mount effect, so `DialogPresence` mounts the shell *above* the component
  that renders `<Dialog>`, and the contents tell it their name, host class, close and
  whether they are an alert through `lib/dialogHost.ts`, in a layout effect. A plain
  `{open && <Dialog/>}` makes a shell of its own, and its body arrives a render later.
  `ConfirmDialogImpl` is shadcn's alert-dialog parts inside that same root, configured as
  Base UI's `AlertDialog.Root` configures it — no dismissal by a click beside it,
  `role="alertdialog"`, focus on the question rather than the answer — so one shell serves
  both and a confirm leaves like any dialog. A dialog holds the top of `lib/useEscape`'s
  stack with a layer that closes nothing (`useEscapeLayer`) and lets Base UI's own listener
  close it, so a panel opened before it never hears the key. The layer is the first load's:
  `DialogPresence` takes it as the dialog opens, because a dialog opened before the chunk
  lands is open but not drawn, and an Escape pressed then went past it to the shell. Until
  the shell reports itself drawn the layer answers the key itself — stopped, default
  prevented — and the shell, once the chunk lands, closes the dialog as soon as the
  contents have registered their close; such a dialog is seen only for its exit. Its popup
  stops every Escape from inside it, which is what keeps Safari's composition-ending Escape
  — sent after `compositionend` with `isComposing: false`, and ignored by Base UI — from
  reaching the shell's listener on `window`, where it closed the thread or marked the
  channel read.
  Focus goes back to the opener as the exit begins, not after it. `DialogPresence` was not
  retired, as the Alternatives above expected: it now holds a dialog through Base UI's exit
  (`onOpenChangeComplete`, with `FALLBACK_MS`, 400 ms, as the backstop rather than the
  floor) and takes its place on the Escape stack, and `usePresence` still holds everything
  that is not Base UI's. Known trades: toasts draw above dialogs, because
  `--z-modal` (90) is below `--z-toast` (110) on the ladder where the native top layer put
  a modal above everything — a toast and its × take clicks over a dialog, and close
  neither kind, because Base UI closes a modal only on a press on its own backdrop; and
  the command palette, a plain mount, takes focus a frame late — its own mount effect runs
  before its input exists, Base UI focuses the input on the next frame, and a key typed in
  that frame goes to the composer.
- **Menus and popovers are scaffolding until phases 4 and 5** (the user's decision,
  2026-11-01). They are not yet shadcn's DropdownMenu and Popover as shadcn means them. No
  caller was edited, so the callers still own their triggers and their items are
  `<button role="menuitem">`s beside a heading, a select and a time field: Base UI's list
  navigation and typeahead could not walk them, its `useListNavigation` would take the
  arrows from that select and time field, and Escape and a click outside must work before
  the chunk has arrived. So they keep the legacy look and Blob's own keys and dismissal,
  and Base UI only places them (flip, shift, `--available-height`, tracking as the page
  moves — `lib/menuFit.ts` is gone), animates them and focuses them: `MenuImpl`'s root is
  `disabled`, and both Impls cancel every close Base UI asks for. The shared pieces:
  `lib/useDismissal.ts`, the first-load contract — a click outside by `contains`, Escape
  through the stack, focus moving out, all suspended while the caller has a dialog up, and
  focus home on close; `lib/useHeldThroughExit.ts`, which mounts the lazy half while open
  and through its exit; `components/PanelAnchor.tsx`, the zero-size anchor where the old
  panel sat, which the panel is drawn into rather than at the end of `<body>`, because the
  callers' CSS keys on the panel being inside them (`:focus-within`, `:has()`), `contains`
  has to find it there and Tab order is the page's order; `components/overlays/inPlace.ts`,
  with the placement each caller's stylesheet asks for in `--menu-*` or `--popover-*`
  (registered not to inherit, by `@property` rules that sit in the `legacy` layer, which
  Chromium, Firefox and WebKit all honour there — see the browser pass below) and
  `takeFocus`, which moves focus in with `preventScroll` (Base UI's own initial focus
  scrolled the shell 115px when the composer's picker opened, a frame before the panel was
  placed) and only from where the panel was opened or from nowhere; and
  `components/menuItems.ts`, the one selector the arrows walk and focus starts on. The
  focus guards Base UI draws round a portal are hidden — the one after the last item
  swallowed Tab, handing focus to a trigger of Base UI's own that these panels do not have —
  and a canary in `Menu.test.tsx` and `Popover.test.tsx` fails if Base UI's attribute stops
  matching. Because Base UI takes a portalled panel's contents out of the tab order once
  focus leaves it, focus moving out closes a menu or a person card; the emoji picker, whose
  closing is its callers', closes on a keyboard focus-out only, and from a `pointerdown`
  until the next key the pointer is the input mode, since a tap moves focus after the
  finger lifts. The exit is in the design spec: phase 4 moves the account menu, the
  section menu and ChannelMenu to `DropdownMenuTrigger` and `DropdownMenuItem`, phase 5
  MessageMenu, and SchedulePicker becomes a Popover; then the root's `disabled`, the
  cancel-all, the anchor span, the guard hiding and its canary, the `--menu-*` properties
  and `components/Menu.tsx` go. Phase 5 also moves PersonCard and both emoji pickers to
  `PopoverTrigger`, and with them go `components/Popover.tsx`, `lib/useDismissal.ts`,
  `components/PanelAnchor.tsx`, the picker's pointer-mode focus-out close, the
  `@property --popover-*` rules and `PopoverImpl`'s cancel-every-close.
- **Checked in three engines.** On 2026-11-01, against the dev server and before the Vite 8
  merge, a Playwright 1.64.1 pass signed in as the seed's demo owner ran nine checks in
  each engine — among them a menu's focus and Tab, the schedule menu's placement and
  fields, Escape through a confirm opened from a menu item, the person card's Escape and
  focus return, a toast clicked over a dialog, and the emoji picker's click, tap and Tab —
  and passed Chromium 9/9, Firefox 9/9 and WebKit 8/9. The one miss predates this phase: a mouse click does
  not focus a button in WebKit, so the opener a menu or dialog captures as it opens is the
  message row or `<body>`, and focus goes back there rather than to the trigger; a keyboard
  open goes back correctly, and `main`'s Menu has the same opener logic. Base UI's own
  triggers fix it by construction in phases 4 and 5.
- **Legacy islands.** Legacy markup drawn inside a shadcn part — a dialog's body, the emoji
  picker's search and grid, an empty state's body and action — is wrapped in
  `[data-legacy]`. The preflight repair in `styles/app/base.css` applies inside an island
  and not inside a `[data-slot]` within it: every rule's condition is
  `:where(:not([data-slot], [data-slot] *), [data-legacy] :not([data-slot], [data-legacy] [data-slot] *))`,
  still zero specificity, and `styles/legacyIsland.test.ts` holds every rule to both
  clauses. A selector cannot ask which ancestor is nearest, so an island inside a component
  inside an island is not reached; nothing draws one.
- **Toasts stay on the first load.** A live region has to be in the document before its
  first message for that message to be announced, so `Toasts` is first-load code. It wears
  shadcn's toast surface in utilities and keeps Blob's engine — the store, the exit through
  `usePresence`, the merge that keeps a leaving toast from being read twice — and
  `toasts.css` is deleted. Confirmation is shadcn's muted note on the same engine.
- **First-load primitives.** Avatar is Base UI's with `keepMounted` on the image. Base UI's
  default mounts the `<img>` once it has loaded, with a starting style for a frame, so a
  cached photo faded in again every time a virtualised row remounted — motion keyed to
  mounting; kept mounted, the image reads its own `complete` before paint, and a cached
  photo is there on the first frame with no fade. The initials no longer crossfade into a
  fetched photo: the photo fades in and the letter goes. EmptyState is built from shadcn's
  `Empty` parts, kept to Blob's reading column, and ListSkeleton from its `Skeleton`, which
  pulses shadcn's way and not at all under reduced motion. Icon is a map onto Lucide
  behind the same 40 exports, sizes and strokes; four of them draw a different picture of
  the same thing — Send a paper plane (`SendHorizontal`), Huddle `Headphones`, Poll
  `ChartBar`, LeaveCall `PhoneOff`.
- **`cn` in build mode.** shadcn's parts merge classes with `cn`, which the avatar, the
  skeleton and the empty state bring onto the first load. `cn/vite` compiles merge tables
  for the class groups this client's sources use, and costs 2.2 KB less there than the
  package's whole tables (239.6 KB against 241.8, measured under Vite 6). The plugin writes
  `src/lib/cn-tables.ts` whenever a fresh scan differs, as every build, dev server and
  vitest run starts, so a stale copy never reaches the app or the tests; it is committed
  because the type checker reads it on a fresh checkout, eslint skips it, and CI's `check`
  job fails when the build it has just run rewrote it — left stale, it would land in the
  next person's unrelated commit. A Vite alias sends the CLI files' bare `import { cn } from "cn"` to
  `lib/utils.ts`, so they use the same bound function.
- **The budget.** Measured under Vite 6, the first load was 219.2 KB at phase 1, against a
  `BUDGET_KB` of 220. The overlay boundary, the dismissal contract and anchor and the
  restyled toasts and notes brought it to 220.8; the first-load primitives added about 18.7
  more — `cn` 8.9, Lucide's 39 glyphs (SettingsIcon has no caller) and its runtime 4.6, the
  Base UI code the avatar shares 3.2 and the avatar itself 1.1, the four components 2.3,
  the three `ui/` files 0.7, `class-variance-authority` 0.4, each gzipped alone. So the
  overlays the ceiling was raised for never reached the first load, and the primitives
  spent it. It measured 239.6 to 239.8 KB under Vite 6 as the phase closed, with
  `BUDGET_KB` at 241. After `main`'s move to Vite 8 was merged in, the same code measured
  231.6 KB, and 231.8 with the stale-build notice and the dialog's first-load Escape layer;
  `BUDGET_KB` is 233, 28 KB under the 260 KB ceiling: the measure rounded up, plus 1 KB,
  because the entry chunk embeds the recent commit subjects for "What's new", so the same
  code weighs a few hundred bytes more or less from one commit to the next, and a budget
  with no room would fail a docs commit.
- **One caller edited.** MessageRow's author button says `aria-haspopup="dialog"`, where it
  said `"menu"`: this phase made the person card a named dialog, and left alone the
  attribute would have been wrong.
- **Deferred to phase 7.** About 1 KB of icons that only lazy chunks draw rides the first
  load, because `Icon.tsx` is one module (per-icon modules behind the same exports would
  fix it); and `cva` with `clsx`, about 0.6 KB, is there only for `ui/empty`'s
  `EmptyMedia` variants, which EmptyState does not use.
