# Interface modernization — 2026-10-08

Asked for: "modernizuj interface i dizajn i interaktivnost" — modernize the interface, the
design and the interactivity.

## The direction is already chosen

The identity is Meadow, artboard `1a` of the design canvas (see the `blob-meadow-design`
notes), and its rules sheet `3a`. Meadow's palette shipped long ago; several of its
*structural* moves never did, and the client reads as a wireframe of it:

| Meadow says | The client did |
|---|---|
| An app frame: the work on paper in a rounded card with the only page-level shadow | Full bleed, every region split by a 1px border |
| A tinted rail (plan item 0.5, decided, not shipped) | `--bg-sidebar` #faf9f6, a point off the page |
| Author names bold | **400** — `button.person-trigger { font: inherit }` outranks `.message-author` since the name became a button |
| "Flat initial avatar in clay or sage" | Two initials, every person the same sage |
| Pills for actions and filters, quiet ghosts for the rest | A mix: one outlined button among ghosts in the channel header |

So "modern" here means finishing Meadow and adding the interactions current chat apps
ship, not a new identity. Constraints that stay: Slack's layout, words and keys; the 44
colour names (values may change, names and order may not); Meadow's motion budget
(120–160ms ease-out, only the shimmer and the pulse loop, nothing bounces); WCAG 2.2 AA in
both themes, measured; Chrome, Firefox and Safari.

## What current practice says (research, 2026-10-08)

Durable, and adopted: elevation as a 1px ring plus soft shadow (Primer, Radix — Blob's
`--elev-*` already is this); tabular numerals for anything that counts or updates
(Polaris, GOV.UK); `:focus-visible` rings of 2px at 3:1 (WCAG 2.2, Primer, Fluent); dark
surfaces dark grey with elevated surfaces lighter (Material, Apple); 100–300ms motion with
springs that do not bounce, under a reduced-motion policy (Apple HIG, Material,
Primer). Fads, and avoided: glass/translucency in web product UI (Apple's own Liquid Glass
is being made more opaque; `backdrop-filter` costs passes), squircles (`corner-shape` is
Chromium-only), bounce on everyday UI.

Interactions the field ships that Blob does not: a "jump to newest" control once you have
scrolled up (Teams since 2025-06, Discord's "Jump to present"); dropping a file anywhere
on the conversation (Discord's window drop, Teams' "Drop your files here"); a profile card
on hover (Slack since 2022, Teams). Slack's composer keeps its formatting toolbar on top,
visible by default — Blob's does too, and keeps it.

## Phases

Each phase is one commit on its own stacked branch (`modern-phase-N`), the client gate
green, the axe + overflow audit clean at 1440 and 400 in both themes against a baseline
taken on main, and a review before the next phase builds on it. Nothing is pushed.

1. **The frame.** Tinted ground for the top bar and channel list; every view and the
   panel beside it on paper in one rounded, shadowed card; the consoles in the same frame;
   dark ground below the page so the card lifts; sidebar row states mixed against the
   ground; a row's options button inside its pill.
2. **The conversation.** Author names at Meadow's weight; one initial in clay or sage per
   person; code blocks with their language and a Copy button; a "Jump to latest" control
   once you have scrolled away from the end.
3. **Home.** A greeting, stat tiles that read as numbers and lead somewhere, unread rows
   that say how much, a two-by-two grid on phones.
4. **Finding and acting.** The ⌘K palette with icons, shortcut hints and a key legend;
   the channel header's actions as one family; the person card on hover as well as click.
5. **The composer and files.** Drop a file anywhere on the conversation; the composer's
   resting and focused states per Meadow.
6. **Motion and focus.** One focus ring; skeletons where a view says "Loading…"; a pass
   over hover and press so every control answers.
