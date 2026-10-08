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

## Where it stands (2026-10-08)

All six built, each a commit on its own stacked branch (`modern-phase-1` … `-6`, then
`modern-docs` for the guide, CLAUDE.md and the README's screenshots), reviewed, and the
review's findings fixed on the phase they belonged to. Not pushed.

What review caught, phase by phase:

1. A PDF or page in the file panel painted over the card's rounded corner (the file panel
   now clips); a CSV preview's sticky header kept the sidebar's tint. The built-in palettes
   whose rail is darker than their sidebar now read as a band across the top — kept, and
   said so in the stylesheet.
2. A code block's Copy button nested inside the button that a search hit and a pinned row
   each are — invalid, and invisible to assistive tech; `renderMarkdown` takes
   `copyableCode: false` there. On touch the always-visible Copy covered one-line blocks;
   it sits below the block there.
3. "Needs you" counted decisions but sent you to the mentions page, which cannot show one;
   it now takes you down Home to the decisions, then the unread mentions. The phone tab
   strip's fade could hide the last tab's underline.
4. The private channel's lock in ⌘K told only the eye; the row says "Private channel".
5. Nothing at the bar. Below it: `dragend` never fires for a file dragged in from the
   desktop (its source is outside the page) — covered, because a cancelled or departing
   drag fires `dragleave` on the current target, which empties the depth count.
6. The skeletons were not shaped like what replaced them: the pinned list's avatars were
   36px over 20px rows, Files drew rows before a grid of tiles, and the skeleton's own
   padding stacked on every container's. Each now matches its rows.

Deferred, with the reason:

- **The person card on hover** (Slack, Teams, Linear). `PersonCard` is built on `Menu`,
  which while open joins the Escape stack and steers ↑↓ window-wide; a card opened by a
  passing pointer would take the composer's ↑ and Escape. It needs a peek mode that does
  neither.
- **`flushSync was called from inside a lifecycle method`** in the dev console when
  messages arrive at the bottom of a conversation — on main too. TanStack Virtual 3.14 has
  `useFlushSync: false` for React 19; turning it off changes rendering during fast scroll
  and wants measuring first.
