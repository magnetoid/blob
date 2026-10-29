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
- **Two departures from b0's values, both for contrast.** Light `--muted-foreground` is
  `oklch(0.54 0 0)` where b0 has `0.556`, which is 4.34:1 on b0's own `--muted` and under
  WCAG AA; 0.54 is 4.64:1. Light `--unread-text` is `#a0663a`, because the colour it
  replaced was 4.42:1 on the page. In dark, an off switch's knob takes `--foreground`, through a
  dark-only bridge, as shadcn's own Switch does: the knob the bridge would otherwise give it,
  `--background`, is 1.7:1 on the off track. `styles/theme.test.ts` holds every b0 value and
  measures the muted grey on every ground it is drawn on.
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
  sidebar) goes to all of them; twenty-five old names have no counterpart and are dropped,
  listed in the migration's docstring, so a custom theme that set one loses that one colour
  and keeps the rest. `ensure_presets` inserts once and never refreshes, so the same
  migration overwrites the twelve shipped presets by slug with a frozen copy — Paper and
  Midnight are b0 light and dark exactly and set nothing, and the other ten are adjusted
  until every text pair, destructive on the sidebar included, is 4.5:1 against b0's values
  for what they leave unset (`tests/test_themes.py` holds it from then on). None was
  retired: nobody's chosen theme falls back silently. The rewrite is safe to meet twice —
  a dict that already holds a name only the new vocabulary has is left alone — but
  `downgrade` cannot restore the old names. The client keeps the palette it replays before
  hydration under `blob.theme.v2`, and never reads the old key again, because a stored
  `--accent` would now paint shadcn's hover wash in the old brand colour.
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
  `blob.theme` is ignored once, then replaced by the server's answer.
- `tests/test_theme_rekey_migration.py` pins the frozen presets and 0078's name lists to the
  live code (`test_the_frozen_presets_are_the_ones_shipped`, and `NEW_NAMES` equal to
  `THEMEABLE_TOKENS`). The first legitimate change to a preset or a themeable name will fail
  them; that is the moment to snapshot the migration's copy, not to edit it.
- Dark mode costs two copies of one palette, kept identical by a test, so that "system"
  works before JavaScript and an explicit choice works after it.
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
