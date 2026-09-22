# The consoles: a page that uses the window, and cards to read it by

**Status:** design, 2026-09-22. Asked for by Marko: *"improve UI and UX in the server admin
page, stretch the content, improve the design slightly".* A layout and visual pass over
`/admin` and `/settings`, which share one shell. An evolution of Meadow, not a redesign:
Instrument Sans, the warm neutrals and the forest accent stay, and so does every
behaviour — no route, request or control changes what it does.

## What is wrong today

* **The page is a column on the left of an empty window.** `.admin-page` stops at 860px,
  and most sections then narrow themselves again — `<section style={{ maxWidth: 520 }}>`,
  `640`, `680`, `.you-page` at 620. On a 1440px screen the People page is 600px of content
  beside 600px of nothing, and the agents table on Apps & agents scrolls sideways inside
  a column less than half the window wide while the window itself is idle.
* **A page has no structure inside it.** Headings are `h2.section-label` overlines and the
  spacing between groups is whatever inline margin the last author chose — 26px on one
  page, 18 on the next, 14 under a button. Nothing says where one group of settings ends.
* **Four treatments of the same things.** Tables have a bold header row in body type and
  a `display: flex` actions cell that falls out of the table's rows; lists are
  `.admin-row`s at 14px; empty states are `p.muted`, `td.muted`, `p.pref-hint` or the
  `EmptyState` component depending on the page; loading is "Loading…" in three styles or
  nothing at all. The nav's filter box is taller and darker-edged than every input on the
  page it filters, and its three badges (`Soon`, `owner`, `New`) are three different pills.
* Three things that are plain bugs: `.sr-only` is used and never defined, so the apps
  table's header shows "Configure" and every bar of the health chart prints its own
  timestamp — and defining it exposes the second, that the bars' `height: 100%` never
  resolved (the plot has a min-height, not a height), so they were only ever as tall as
  that timestamp; the Feedback row's `Open` sits against its title because `.admin-row`
  outranks the `.block` meant to undo it; and the agents table's actions cell is a
  `display: flex` `<td>`, which leaves the table and takes its row rule with it.

## The frame

* **One container.** `.admin-page` is centred in the main column at
  `max-width: calc(var(--console-width) + 2 × gutter)` with `--console-width: 1120px`, and
  every section fills it. The gutter steps with the viewport: 40px on a desk, 32px below
  1200px, 24px once the nav is a drawer (≤900px) and 16px on a phone (≤600px), which is
  where cards go edge to edge inside that 16px. Centred rather than left-aligned because a
  2000px window otherwise puts all the content against the nav and the air on the right.
* **Prose keeps its measure.** Page descriptions, card descriptions and `.pref-hint` are
  capped at 68ch inside whatever column they are in; the column stretches, the line does
  not.
* **The page header** keeps its title and description and gains room and a hairline under
  it across the content width, so the page's name and the page's contents are two things.
* **The error line** under the header becomes a tinted strip, still `.error-text`, so a
  failure reads as a notice about the page rather than as a stray red sentence.
* `.admin-main` gets `scrollbar-gutter: stable`: a centred column would otherwise move
  sideways by a scrollbar's width whenever a section is long enough to scroll.

## Cards

A card is the unit a page is read in: one group of settings, one list, one table.

| Class | What it is |
|---|---|
| `.console-stack` | The page body: cards in a column, `--space-6` apart. |
| `.console-card` | `--surface`, `--elev-1` and no border (the elevation carries its ring), `--radius-lg`, 20/24px padding, and `overflow: clip` so a flush list's hover stays inside the corners. Not a size container — see the fix round below. |
| `.console-card-header` | Title (`h2.console-card-title`, the old `h2.section-label`'s job) and an optional one-line `.console-card-desc`; `.console-card-actions` at the end for a card-wide control such as "+ Install agent". |
| `.console-card-footer` | A strip across the bottom for what closes the card — a Save, a "Load older", a closing note. |
| `.console-list` | Rows flush to the card's edges, hairlines between them, a hover wash. The old `.admin-table` divs that were really lists. |
| `.console-table-wrap` | A real `<table class="admin-table">`, flush likewise; scrolls inside its own box — sideways on a phone, and downwards past 70vh — with the header row sticky while it does. |
| `.console-notice` | The one empty-or-loading line every card uses, centred where the rows would be. |
| `.console-inline-form`, `.console-form-grid` | A form in a row (invite, webhook) and fields on a grid (a new group, an emoji, the profile). |

`features/console/Card.tsx` is the React half: `Card` (title, description, actions,
footer, children) and `CardNotice`. Cards are sections without an accessible name, so
they add headings to the page and no landmarks.

Inside a card, `.pref-row` is the two-column settings row it already was — label and hint
on the left, control on the right — with the same 16px rhythm on every page and a
hairline between rows rather than under each. It wraps its control under the label when
the card, not the window, is too narrow for both. Text inputs and selects stop at a width
that suits what goes in them instead of stretching to the card.

Muted text was measured where it now sits — `--surface`, the footer strip, the table's
header band, and the row hover mixed from `--surface-hover` — by compositing the real
computed colours in the browser: every text token from `--text-2` to `--text-faint` is
at or above 4.5:1 in both themes, and the lowest is `--text-faint` on a hovered row, at
4.75 in light and 4.78 in dark. The error strip is 5.6 and 4.8. The dimmed rows (a
deactivated person, an archived channel) stop dimming with `opacity`, which took their
meta text to about 2.5:1, and dim the name's colour instead; the pill beside it still
says why. The one guardrail that is not live yet loses the same `opacity` for the same
reason.

## The nav

* The current row is the accent wash it was, plus a 3px accent bar at its left edge, so
  "where am I" does not rest on a background tint alone.
* Group labels and rows get one spacing: 16px between groups, 32px rows.
* `Soon`, `Owner` and `New` become one badge (`.console-nav-badge`) in three kinds —
  dashed for not built, outlined for owner-only, accent for new — same height, same type,
  aligned at the row's end. It replaces `user-menu-soon` and `role-pill` here, which
  belong to the account menu and to people.
* The filter is `.console-nav-filter`: the inputs' own border, radius, surface and focus
  colour, at a height that suits a nav.
* The drawer below 900px is unchanged: `.admin-shell`, `.admin-nav`, `.admin-nav-scrim`
  and `.admin-nav-toggle` keep their names and rules.

## Motion

One: the page body enters when the section changes. `.admin-page-body` is keyed by the
section in `ConsoleShell`, and plays `console-enter` — opacity from 0 and a
`--motion-slide` rise, over `--dur-open` on `--ease-out`, filling backwards only so
nothing holds a transform once it has arrived. Reduced motion takes the rise to zero and
keeps the fade, which is the existing token policy. A detail id changing inside a section
(Apps → one app) does not replay it. Nothing else here moves; buttons and toggles belong to
the motion layer, not to this pass.

## Tokens

`tokens.css` gains a `--space-1` … `--space-12` ladder (4px steps up to 24, then 32, 40,
48) and `--console-width`, both below the colour block and both structure. The console
spends them; the chat is not re-spaced. No colour name is added, renamed or moved.

## What stays, and why

* **Every control, route, request and piece of copy.** Where a list had no empty or
  loading line (Channels), it gets the sibling pages' wording; nothing else is reworded.
* **Tables stay tables and lists stay lists.** People, Channels, Invitations, Webhooks,
  Deliveries, Audit, Feedback and Errors and logs are rows of a thing with its actions;
  Accounts, Groups, Emoji, the agents, Skills and Installs are tables. Turning a list into
  a table would change what a screen reader says, which is not this pass's to change.
* **The Health dashboard keeps its widgets.** They become the same elevated surface as a
  card — one ring, not a border plus a ring — and the dashboard finally gets the width its
  twelve-column grid was drawn for.
* **Dialogs stay outside cards.** A `<dialog>` is centred by the platform with
  `margin: auto`; a card's spacing rule would move it.
* **The chat.** `.pref-row`, `.channel-row`, `.section-label` and `.empty-state` are
  shared; every change to them is scoped under the console.

## Before and after, by kind of page

| Page | Before | After |
|---|---|---|
| **Settings pages** — General, App policy, You, the Janus workspace half | A 520–620px column of rows and overlines; Save under the field wherever it fell | Titled cards; rows two columns across the card; Save in the card's footer; hints at 68ch |
| **List pages** — People, Channels, Webhooks, Deliveries, Audit, Feedback, Errors and logs | Rows ruled on the page background, actions wherever the row ended | A card per list; filters and search at its top; rows flush to its edges with a hover; the same notice when empty or loading |
| **Table pages** — Accounts, Groups, Emoji, Apps & agents, Janus's skills and installs | Bold header in body type, actions cell out of the table, a sideways scroll at desk width | Uppercase label header, sticky when the table scrolls; numbers in tabular figures and right-aligned; actions at the row's end |
| **Forms** — a new group, an emoji, a webhook, an invitation, an agent, an assistant | A two-column grid with the heading in one column and its paragraph in the other, buttons stretched across a cell | A form card: the heading and paragraph as its header, fields on a grid or in a row, the button at the end |
| **Dashboards** — Health, the agents console | Twelve columns squeezed into 600px | The same grids at 1120px; the agents table and its guardrails side by side where they fit and stacked where they do not |

## Verification

* `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run` in `apps/web`; the inline-style
  ratchet lowered to its new count.
* Tests: `Card.test.tsx` for the card's parts and its semantics (a heading, no
  landmark); `ConsoleShell.test.tsx` for the body re-mounting on a section change and
  not on a detail change, and the error clearing; `AdminConsole.test.tsx` for a People
  part at its old URL getting its card and a detail page not getting a second; one more
  nav test for the single badge. The existing nav, registry and section tests are
  unchanged in what they assert.
* In a browser, every admin and settings section at 1440 and 400px in light and dark,
  before and after; 1024 and 768 checked; no sideways scroll at 400px; keyboard focus
  visible in the nav and on cards' controls.

## Not in this

The type scale (still px, see the traps list); a table that becomes cards on a phone;
anything the calls work will add to the nav beyond rendering whatever group it brings;
the top bar.

## Fix round 1

A merge-grade review approved the pass with fixes, and confirmed it presentation-only by
comparing every handler, ARIA attribute and prop before and after. What it found, and
what changed.

* **Touch targets.** `.admin-nav .channel-row { min-height: 32px }` outranked the app's
  coarse-pointer rule for `.channel-row`, so on a phone — where the drawer is the only
  way around — the rows were 32px; and `.console-filter` at 36px made the nav filter and
  the People and Accounts searches smaller than the 44px search field they replaced. A
  `@media (pointer: coarse)` block after the nav's rules sets the rows to 44px and the
  filter to a 44px *height* rather than a minimum, so the input that fills it is the big
  thing (42px inside the border). The dashboard's two selects, which this pass drew at
  32px, are 44px on touch as well, like the dashboard's own buttons.
* **Long tables.** `overscroll-behavior: contain` is gone from `.console-table-wrap`,
  so scrolling carries on to the page at either end of the box. The header row has an
  exact height now — `--table-head-height: 32px` on `.admin-shell`, spent as the header
  cells' line-height less their padding — and the box's `scroll-padding-top` is the same
  variable, so a row that takes focus while the table scrolls lands under the sticky
  header, not behind it (WCAG 2.2, 2.4.11). On a Groups table grown to 41 rows, a button
  focused 5px under the box's top edge scrolled to 33px, clear of the header; with the
  padding off it stayed at 5, hidden. At 600px and below the box has `max-height: none`
  and keeps only its sideways scroll: no scroller inside a scroller under a thumb.
* **`/admin/users/:id` rendered without a card.** `framed()` skipped the card for any
  detail id, and only Groups draws a page of its own under its URL. It takes
  `{ drawsItsDetailPage }` now, set for Groups alone.
* **A list whose first load fails.** Channels said "Loading…" for ever: its list starts
  null and only an answer changed that. It tracks the failure now and draws no card, so
  the page is its error. Webhooks, Deliveries and Logs did not stick — they key off
  `useAdminData`'s `loading`, and Audit sets `loaded` in `finally` — but they fell
  through to "No webhooks yet", "No delivery attempts recorded yet" and "Nothing has gone
  wrong recently" under the error that contradicted them. One rule for all four now: no
  data and nothing in flight means the load failed, and the card claims nothing about rows
  it never read (Deliveries and the webhook list draw no card; Logs keeps its toolbar).
  One group's members had the endless "Loading…" too, from before this pass, and has the
  same fix. Audit is left alone: it swallows its errors and says "Nothing recorded yet",
  and reporting them would be behaviour rather than layout.
* **General's field lost click-to-focus.** The card's title is the field's
  `<label htmlFor>` now, inside the `h2`; the hint stays `aria-describedby`. `Card` lost
  its `titleId` prop, which nothing else used.
* **Switches under their labels on small phones.** A card row's label has a 200px flex
  basis, not 260: at 260 a switch dropped under its label below a 388px viewport. At
  360px every switch on You sits beside its label.
* **The card is no longer a size container.** Nothing queried `container: card`, and
  inline-size containment left a card no intrinsic width. The chip row the review pointed
  at — Pause notifications, hanging off the right on a phone — needed no query: the
  chips' `justify-content: flex-end` did nothing while they sat beside the label and, once
  they wrapped onto a line of their own, right-aligned each line. It is gone; wrapped
  chips start at the left like the label above them (checked at 360 and 400).
* **Dead CSS.** Removed, each after a grep of `apps` and `packages` found nothing using
  it: `.sidebar-search`, `.admin-apps-shell`, `.admin-apps-intro` (and its line in the
  900px block), `.admin-apps-title`, `.log-toolbar`, `.log-toolbar .chip-row`,
  `.log-list`. `.dashboard-widget` lost its transition altogether: nothing about a widget
  changes once it is drawn, so it was easing a hover no rule set and a border it no longer
  has.
* **Headings.** `CardHeading` in `Card.tsx` is an h3 in a titled card and an h2 in an
  untitled one. "New group" uses it, so `/admin/groups` runs h1 → h2 and the People page
  h2 → h3; so do the app page's "Recent runs" and "Deliveries", which were h5s under an
  h2 card title and are h3s now. A card drops a direct child heading's own margins, as it
  did a paragraph's, because the default differs by level; the activity panel's two keep
  their old 20px in the panel's own terms. No level is skipped on any of the 22 console
  routes, swept in the browser.
* **Two problems from before this pass.** Health's chosen metric tile paired its accent
  border with `--elev-2`, whose ring drew a second edge outside it; it keeps the border
  and drops the shadow. The service tiles beside it did the same on hover and focus and
  got the same fix (the global focus ring still marks focus). The Groups rename field had
  no accessible name; it is "New name for @handle".

**For the owner:** the app page now puts Channels below Owner and Permissions. The
identity card (Endpoint, Owner, Permissions) comes first and Channels is a card of its own
after it; before, Channels sat between Endpoint and Owner. The before/after table above
does not say so.

**Verification.** `pnpm typecheck`, `pnpm lint` and `pnpm exec vitest run` clean: 103
files and 864 tests, from 101 and 852. New: `LoadFailure.test.tsx` (6),
`GroupsSection.test.tsx` (2), three `CardHeading` tests and a label-as-title test in
`Card.test.tsx` (in place of the `titleId` one), and `/admin/users/:id` in
`AdminConsole.test.tsx`. The inline-style ratchet stays at 47. In a browser against a
throwaway database: 44px nav rows, filters and selects under touch emulation; the focus
test above; switches at 360px; wrapped chips at 360 and 400; each failed load, with the
requests stubbed to fail; the label click on General; `/admin/users/:id` in its card; and
no sideways scroll on the 22 routes at 400 and 1440. Screenshots are in `.shots/fix/`.
